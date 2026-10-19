import { fenceRunChildren } from './run-child-fence.js';
import { fenceRunTools } from './run-tool-events.js';
import { assertRunRevisionAvailable } from './run-participant-sql.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Revocation is committed with its policy change. Dispatched effects remain unknown. */
export async function cancelRunsInScope(tx: SqlExecutor, userId: number, appId: string, now: number): Promise<void> {
	let cursor = '';
	while (true) {
		const rows = await tx.all(
			`SELECT id,version FROM agent_runs WHERE user_id=? AND app_id=? AND status IN ('pending','running','unknown') AND id>? ORDER BY id LIMIT 128`,
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
				"UPDATE agent_runs SET status='cancelled',version=?,updated_at=? WHERE id=? AND version=? AND status IN ('pending','running','unknown')",
				[version, now, row.id, row.version],
			);
			if (result.changes !== 1) {
				throw new Error('Lost Run revocation CAS');
			}
			await tx.run(
				"INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at) VALUES(?,(SELECT COALESCE(MAX(sequence),0)+1 FROM agent_run_events WHERE run_id=?),'run.cancelled',?,?)",
				[row.id, row.id, version, now],
			);
			await fenceRunSteps(tx, row.id, version, now);
		}
		if (rows.length < 128) {
			return;
		}
	}
}

export async function fenceRunSteps(tx: SqlExecutor, runId: string, version: number, now: number): Promise<void> {
	const exhausted = await tx.one(
		"SELECT run_id FROM agent_run_model_steps WHERE run_id=? AND state IN ('reserved','dispatched') AND revision>=? LIMIT 1",
		[runId, Number.MAX_SAFE_INTEGER],
	);
	if (exhausted) {
		throw new Error('Run step fence revision exhausted');
	}
	await fenceRunChildren(tx, runId, now);
	await fenceRunTools(tx, runId, now);
	const events = await tx.run(
		`INSERT INTO agent_run_model_step_events(run_id,step_index,sequence,kind,created_at)
 SELECT run_id,step_index,revision+1,CASE WHEN state='reserved' THEN 'step.failed' ELSE 'step.unknown' END,?
 FROM agent_run_model_steps WHERE run_id=? AND state IN ('reserved','dispatched')`,
		[now, runId],
	);
	const changed = await tx.run(
		`UPDATE agent_run_model_steps
 SET failure_code=CASE WHEN state='reserved' THEN 'DISPATCH_NOT_STARTED' ELSE NULL END,
 state=CASE WHEN state='reserved' THEN 'failed' ELSE 'unknown' END,
 expected_run_version=?,revision=revision+1,updated_at=? WHERE run_id=? AND state IN ('reserved','dispatched')`,
		[version, now, runId],
	);
	if (events.changes !== changed.changes) {
		throw new Error('Run revocation step event/state mismatch');
	}
}
