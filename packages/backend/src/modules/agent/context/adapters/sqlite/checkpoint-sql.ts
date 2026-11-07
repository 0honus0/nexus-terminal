import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredCheckpoint } from '../../storage/checkpoint-storage.js';
import { storedInteger, storedText } from '../../../runs/adapters/sqlite/run-participant-sql.js';

export async function initializeContextCheckpoints(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_context_checkpoints (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL,step_index INTEGER NOT NULL,tool_id TEXT NOT NULL UNIQUE,
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64),source_messages INTEGER NOT NULL CHECK(source_messages>=1),
 summary_text TEXT NOT NULL CHECK(length(CAST(summary_text AS BLOB)) BETWEEN 1 AND 16384),created_at INTEGER NOT NULL,
 UNIQUE(run_id,step_index),
 FOREIGN KEY(run_id,step_index) REFERENCES agent_model_contexts(run_id,step_index) ON DELETE CASCADE,
 FOREIGN KEY(tool_id) REFERENCES agent_run_tools(id) ON DELETE CASCADE);`);
}

export function checkpointRow(row: Record<string, unknown>): StoredCheckpoint {
	const summary = storedText(row.summary_text);
	const sourceHash = storedText(row.source_hash);
	if (
		!summary.trim() ||
		Buffer.byteLength(summary, 'utf8') > 16384 ||
		Buffer.from(summary, 'utf8').toString('utf8') !== summary ||
		!/^[a-f0-9]{64}$/u.test(sourceHash)
	) {
		throw new Error('Corrupt context checkpoint');
	}
	return {
		id: storedText(row.id),
		runId: storedText(row.run_id),
		stepIndex: storedInteger(row.step_index, 1),
		sourceHash,
		sourceMessages: storedInteger(row.source_messages, 1),
		summary,
		createdAt: storedInteger(row.created_at),
	};
}
