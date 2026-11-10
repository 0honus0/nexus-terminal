// Frozen published database migration dependency. Not an application API.
import { createHash, randomUUID } from 'node:crypto';

import type { SqlExecutor } from '../../../../../../../sql-types.js';

import { storedInteger, storedText } from './run-participant-sql.js';

/** Historical text is converted once; ordinary reads use only the current App message journal. */
export async function migrateRunMessageLineage(tx: SqlExecutor): Promise<void> {
	await tx.exec('ALTER TABLE agent_app_messages ADD COLUMN operation_sequence INTEGER NOT NULL DEFAULT 0;');
	await tx.run(
		`UPDATE agent_app_messages SET operation_sequence=COALESCE(
	 (SELECT sequence FROM agent_operations WHERE id=agent_app_messages.operation_id),0)`,
		[],
	);
	const groups = await tx.all(
		`SELECT e.run_id,e.step_index,MIN(e.created_at) AS created_at FROM agent_run_model_step_events e
	 WHERE e.kind='text.delta' GROUP BY e.run_id,e.step_index ORDER BY e.run_id,e.step_index`,
		[],
	);
	for (const group of groups) {
		const id = randomUUID();
		const runId = storedText(group.run_id);
		const step = storedInteger(group.step_index, 1);
		await tx.run(
			`INSERT INTO agent_app_messages(id,run_id,owner_id,message_key,ordinal,operation_id,chunks,created_at,operation_sequence)
		 SELECT ?,?,'migration:50',?,COALESCE(MAX(ordinal),0)+1,NULL,0,?,0 FROM agent_app_messages WHERE run_id=?`,
			[id, runId, String(step), storedInteger(group.created_at), runId],
		);
		let after = 0;
		let chunks = 0;
		for (;;) {
			const page = await tx.all(
				`SELECT sequence,text_delta,created_at FROM agent_run_model_step_events
			 WHERE run_id=? AND step_index=? AND kind='text.delta' AND sequence>? ORDER BY sequence LIMIT 64`,
				[runId, step, after],
			);
			if (!page.length) {
				break;
			}
			for (const row of page) {
				const text = storedText(row.text_delta);
				await tx.run(
					'INSERT INTO agent_app_message_chunks(message_id,chunk_index,text,sha256,created_at) VALUES(?,?,?,?,?)',
					[
						id,
						chunks++,
						text,
						createHash('sha256').update(text).digest('hex'),
						storedInteger(row.created_at),
					],
				);
				after = storedInteger(row.sequence, 1);
			}
		}
		await tx.run('UPDATE agent_app_messages SET chunks=? WHERE id=?', [chunks, id]);
	}
}
