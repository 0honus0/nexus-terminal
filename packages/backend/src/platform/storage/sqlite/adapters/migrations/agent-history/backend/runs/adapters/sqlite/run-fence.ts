// Frozen published database migration dependency. Not an application API.
import { assertRunRevisionAvailable, storedInteger, storedText } from './run-participant-sql.js';

import type { SqlExecutor } from '../../../../../../../sql-types.js';

/** Revocation is committed with its policy change. Dispatched effects remain unknown. */
export async function cancelRunsInScope(tx: SqlExecutor, userId: number, appId: string, now: number): Promise<void> {
	let cursor = '';
	while (true) {
		const rows = await tx.all(
			`SELECT id,version FROM agent_runs WHERE user_id=? AND app_id=? AND status IN ('pending','running','suspended','unknown') AND id>? ORDER BY id LIMIT 128`,
			[userId, appId, cursor],
		);
		for (const row of rows) {
			if (
				typeof row.id !== 'string' ||
				typeof row.version !== 'number' ||
				!Number.isSafeInteger(row.version) ||
				row.version < 1
			) {
				throw new Error('Corrupt Run revocation identity');
			}
			cursor = row.id;
			assertRunRevisionAvailable(row.version);
			const version = row.version + 1;
			const result = await tx.run(
				"UPDATE agent_runs SET status='cancelled',version=?,updated_at=? WHERE id=? AND version=? AND status IN ('pending','running','suspended','unknown')",
				[version, now, row.id, row.version],
			);
			if (result.changes !== 1) {
				throw new Error('Lost Run revocation CAS');
			}
			await tx.run(
				"INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at) VALUES(?,(SELECT COALESCE(MAX(sequence),0)+1 FROM agent_run_events WHERE run_id=?),'run.cancelled',?,?)",
				[row.id, row.id, version, now],
			);
			await fenceRunExecution(tx, row.id, now);
		}
		if (rows.length < 128) {
			return;
		}
	}
}

export async function fenceRunExecution(tx: SqlExecutor, runId: string, now: number): Promise<void> {
	// Stop new admission without rewriting dispatched receipts or inventing rollback.
	// The live owner retains all accepted work until its actual outcome is recorded.
	await tx.run("UPDATE agent_run_executions SET state='draining',updated_at=? WHERE run_id=? AND state='open'", [
		now,
		runId,
	]);
	const exhausted = await tx.one(
		`SELECT 1 FROM agent_operation_approvals a JOIN agent_operations o ON o.id=a.operation_id
	 WHERE o.run_id=? AND a.status IN ('requested','approved') AND a.consumed_at IS NULL AND a.version>=? LIMIT 1`,
		[runId, Number.MAX_SAFE_INTEGER],
	);
	if (exhausted) {
		throw new Error('Operation approval revision exhausted');
	}
	await tx.run(
		`UPDATE agent_operation_approvals SET status='superseded',version=version+1
	 WHERE operation_id IN (SELECT id FROM agent_operations WHERE run_id=?)
	 AND status IN ('requested','approved') AND consumed_at IS NULL`,
		[runId],
	);
	await fenceRunChildren(tx, runId, now);
}

/** The direct-child set is fenced in the parent's transaction. */
export async function fenceRunChildren(
	tx: SqlExecutor,
	parentId: string,
	now: number,
	ids: string[] | null = null,
): Promise<string[]> {
	const rows = await tx.all(
		`SELECT r.id,r.version FROM agent_runs r JOIN agent_run_children c ON c.run_id=r.id WHERE c.parent_id=? AND r.status IN ('pending','running','suspended','unknown') ORDER BY r.id`,
		[parentId],
	);
	const cancelled: string[] = [];
	for (const row of rows) {
		const id = storedText(row.id);
		if (ids !== null && !ids.includes(id)) {
			continue;
		}
		assertRunRevisionAvailable(row.version);
		const version = storedInteger(row.version, 1) + 1;
		const changed = await tx.run(
			"UPDATE agent_runs SET status='cancelled',version=?,updated_at=? WHERE id=? AND version=?",
			[version, now, id, version - 1],
		);
		if (changed.changes !== 1) {
			throw new Error('Lost child fence CAS');
		}
		await tx.run(
			"INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at) VALUES(?,(SELECT COALESCE(MAX(sequence),0)+1 FROM agent_run_events WHERE run_id=?),'run.cancelled',?,?)",
			[id, id, version, now],
		);
		await fenceRunExecution(tx, id, now);
		cancelled.push(id);
	}
	return cancelled;
}
