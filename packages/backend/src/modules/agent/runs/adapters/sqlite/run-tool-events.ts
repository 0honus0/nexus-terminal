import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredToolOperation } from '../../storage/run-tool-storage.js';

export async function recordToolEvent(tx: SqlExecutor, operation: StoredToolOperation): Promise<void> {
	await tx.run(
		'INSERT INTO agent_run_tool_events(tool_call_id,revision,operation_revision,state,operation_hash,created_at) VALUES(?,?,?,?,?,?)',
		[
			operation.id,
			operation.revision,
			operation.operationRevision,
			operation.state,
			operation.operationHash,
			operation.updatedAt,
		],
	);
}

/** A persisted dispatch cannot become a definite cancellation on restart or revocation. */
export async function fenceRunTools(tx: SqlExecutor, runId: string | null, now: number): Promise<number> {
	const scope = runId === null ? '' : 'AND run_id=?';
	return fenceTools(tx, scope, runId === null ? [] : [runId], now);
}

export function fenceTerminalRunTools(tx: SqlExecutor, now: number): Promise<number> {
	return fenceTools(
		tx,
		"AND run_id IN (SELECT id FROM agent_runs WHERE status NOT IN ('pending','running'))",
		[],
		now,
	);
}

async function fenceTools(
	tx: SqlExecutor,
	scope: string,
	scopeParameters: (string | number)[],
	now: number,
): Promise<number> {
	await tx.run(
		`UPDATE agent_context_compactions SET state=CASE WHEN state='reserved' THEN 'failed' ELSE 'unknown' END,
		updated_at=? WHERE state IN ('reserved','dispatched') ${scope}`,
		[now, ...scopeParameters],
	);
	await tx.run(
		`UPDATE agent_thread_titles SET state=CASE WHEN state='reserved' THEN 'failed' ELSE 'unknown' END,
		updated_at=? WHERE state IN ('reserved','dispatched') ${scope}`,
		[now, ...scopeParameters],
	);
	const exhausted = await tx.one(
		`SELECT id FROM agent_run_tools WHERE state IN ('inspected','dispatched') ${scope} AND revision>=? LIMIT 1`,
		[...scopeParameters, Number.MAX_SAFE_INTEGER],
	);
	const approval = await tx.one(
		`SELECT id FROM agent_governance_approvals WHERE status='requested' AND version>=?
		 AND tool_call_id IN (SELECT id FROM agent_run_tools WHERE state IN ('inspected','dispatched','unknown','cancelled') ${scope}) LIMIT 1`,
		[Number.MAX_SAFE_INTEGER, ...scopeParameters],
	);
	if (exhausted || approval) {
		throw new Error('Tool fence revision exhausted');
	}
	const parameters = [now, ...scopeParameters];
	const events = await tx.run(
		`INSERT INTO agent_run_tool_events(tool_call_id,revision,operation_revision,state,operation_hash,created_at)
 SELECT id,revision+1,operation_revision,CASE WHEN state='dispatched' THEN 'unknown' ELSE 'cancelled' END,operation_hash,?
 FROM agent_run_tools WHERE state IN ('inspected','dispatched') ${scope}`,
		parameters,
	);
	const changed = await tx.run(
		`UPDATE agent_run_tools SET state=CASE WHEN state='dispatched' THEN 'unknown' ELSE 'cancelled' END,
 revision=revision+1,updated_at=? WHERE state IN ('inspected','dispatched') ${scope}`,
		parameters,
	);
	if (events.changes !== changed.changes) {
		throw new Error('Tool fence event/state mismatch');
	}
	await tx.run(
		`UPDATE agent_governance_approvals SET status='superseded',version=version+1 WHERE status='requested'
 AND tool_call_id IN (SELECT id FROM agent_run_tools WHERE state IN ('unknown','cancelled') ${scope})`,
		scopeParameters,
	);
	return changed.changes;
}
