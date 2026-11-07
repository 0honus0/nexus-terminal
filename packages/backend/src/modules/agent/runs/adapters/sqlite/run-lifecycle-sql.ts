import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredRunUnstartedFailure, StoredRunUsage } from '../../storage/run-storage.js';
import { assertRunRevisionAvailable, storedInteger } from './run-participant-sql.js';

export async function failUnstartedRun(tx: SqlExecutor, command: StoredRunUnstartedFailure): Promise<boolean> {
	assertRunRevisionAvailable(command.expectedVersion);
	const result = await tx.run(
		`UPDATE agent_runs SET status='failed',version=version+1,updated_at=?
	 WHERE id=? AND user_id=? AND app_id=? AND version=? AND status='pending'
	 AND NOT EXISTS(SELECT 1 FROM agent_operations o WHERE o.run_id=agent_runs.id AND o.state IN ('accepted','dispatched','unknown'))
	 AND NOT EXISTS(SELECT 1 FROM agent_run_executions e WHERE e.run_id=agent_runs.id AND e.state<>'closed')
	 AND (EXISTS(SELECT 1 FROM agent_command_idempotency i WHERE i.run_id=agent_runs.id AND i.command_name='create_run'
	 AND i.result_outcome='created' AND i.request_hash=?) OR EXISTS(
	 SELECT 1 FROM agent_run_children c WHERE c.run_id=agent_runs.id AND c.request_hash=?))`,
		[
			command.now,
			command.runId,
			command.userId,
			command.appId,
			command.expectedVersion,
			command.creationHash,
			command.creationHash,
		],
	);
	if (result.changes === 0) {
		return false;
	}
	await tx.run(
		`INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at)
	 VALUES(?,(SELECT COALESCE(MAX(sequence),0)+1 FROM agent_run_events WHERE run_id=?),'run.failed',?,?)`,
		[command.runId, command.runId, command.expectedVersion + 1, command.now],
	);
	return true;
}

export async function runOperationUsage(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	runId: string,
): Promise<StoredRunUsage | null> {
	const row = await tx.one(
		`WITH requested AS (SELECT id,user_id,app_id,version FROM agent_runs WHERE id=? AND user_id=? AND app_id=?),
	 family AS (SELECT r.id FROM agent_runs r JOIN requested q ON r.user_id=q.user_id AND r.app_id=q.app_id
	 WHERE r.id=q.id OR r.id IN (SELECT run_id FROM agent_run_children WHERE parent_id=q.id)),
	 totals AS (SELECT COUNT(*) AS requests,COUNT(m.input_tokens) AS reported,SUM(m.input_tokens) AS inputs,SUM(m.output_tokens) AS outputs
	 FROM agent_operation_model_reservations m JOIN agent_operations o ON o.id=m.operation_id WHERE o.run_id IN (SELECT id FROM family))
	 SELECT q.id,q.version,t.*,(SELECT COUNT(*) FROM agent_operations WHERE kind='tool' AND state<>'accepted'
	 AND run_id IN (SELECT id FROM family)) AS tools FROM requested q CROSS JOIN totals t`,
		[runId, userId, appId],
	);
	if (!row) {
		return null;
	}
	const requests = storedInteger(row.requests);
	const reported = storedInteger(row.reported);
	const inputTokens = row.inputs === null ? null : storedInteger(row.inputs);
	const outputTokens = row.outputs === null ? null : storedInteger(row.outputs);
	if (
		reported > requests ||
		(reported === 0) !== (inputTokens === null) ||
		(inputTokens === null) !== (outputTokens === null) ||
		(inputTokens !== null && outputTokens !== null && !Number.isSafeInteger(inputTokens + outputTokens))
	) {
		throw new Error('Invalid operation usage totals');
	}
	return {
		runId,
		runVersion: storedInteger(row.version, 1),
		inputTokens,
		outputTokens,
		reportedModelRequests: reported,
		modelRequests: requests,
		toolExecutions: storedInteger(row.tools),
	};
}

/** A lost App stack is a failed execution. Only unresolved effects make it unknown; nothing is replayed. */
export async function recoverRunExecutions(tx: SqlExecutor, now: number): Promise<number> {
	const exhausted = await tx.one(
		"SELECT id FROM agent_runs WHERE status IN ('pending','running') AND version>=? LIMIT 1",
		[Number.MAX_SAFE_INTEGER],
	);
	if (exhausted) {
		throw new Error('Run recovery revision exhausted');
	}
	const state = `CASE WHEN EXISTS(SELECT 1 FROM agent_operations o WHERE o.run_id=r.id AND o.state IN ('dispatched','unknown'))
	 OR EXISTS(SELECT 1 FROM agent_run_children c JOIN agent_operations o ON o.run_id=c.run_id
	 WHERE c.parent_id=r.id AND o.state IN ('dispatched','unknown'))
	 OR EXISTS(SELECT 1 FROM agent_tool_jobs j WHERE j.state IN ('dispatched','unknown') AND
	 (j.run_id=r.id OR j.run_id IN (SELECT run_id FROM agent_run_children WHERE parent_id=r.id)))
	 THEN 'unknown' ELSE 'failed' END`;
	const events = await tx.run(
		`INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at)
	 SELECT r.id,(SELECT COALESCE(MAX(sequence),0)+1 FROM agent_run_events e WHERE e.run_id=r.id),'run.'||(${state}),r.version+1,?
	 FROM agent_runs r WHERE r.status IN ('pending','running')`,
		[now],
	);
	const changed = await tx.run(
		`UPDATE agent_runs AS r SET status=(${state}),version=version+1,updated_at=? WHERE status IN ('pending','running')`,
		[now],
	);
	if (changed.changes !== events.changes) {
		throw new Error('Run recovery event/state mismatch');
	}
	return changed.changes;
}
