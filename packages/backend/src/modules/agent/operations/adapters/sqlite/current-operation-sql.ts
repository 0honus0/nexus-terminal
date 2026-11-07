import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredOperation, StoredOperationDispatchAuthority } from '../../storage/operation-storage.js';
import { currentDispatchAuthority } from './operation-dispatch-authority.js';
import { operationAuthority } from './operation-authority-row.js';
import { operationRow } from './operation-row.js';

/** Reuse the committed dispatch proof in the domain's actual write transaction. */
export async function currentOperation(
	tx: SqlExecutor,
	input: { userId: number; appId: string; runId: string; operationId: string; operationHash: string },
	options: { labels: readonly string[]; allowCompleted?: boolean; allowModel?: boolean },
	clock: () => number = Date.now,
): Promise<{ operation: StoredOperation; authority: StoredOperationDispatchAuthority } | null> {
	const row = await tx.one(
		`SELECT o.*,proof.proof_json FROM agent_operations o
	 JOIN agent_operation_authorities proof ON proof.operation_id=o.id
	 JOIN agent_runs r ON r.id=o.run_id AND r.user_id=o.user_id AND r.app_id=o.app_id
	 JOIN agent_run_executions e ON e.run_id=r.id AND e.generation=o.execution_generation AND e.state IN ('open','draining')
	 JOIN agent_apps a ON a.id=r.app_id AND a.user_id=r.user_id AND a.enabled=1
	 WHERE o.id=? AND o.user_id=? AND o.app_id=? AND o.run_id=? AND o.request_hash=? AND r.status='running'
	 AND r.deadline_at>?`,
		[input.operationId, input.userId, input.appId, input.runId, input.operationHash, clock()],
	);
	if (!row) {
		return null;
	}
	const operation = operationRow(row);
	if (
		!(
			(operation.kind === 'effect' && options.labels.includes(operation.label)) ||
			(options.allowModel && operation.kind === 'model')
		) ||
		(operation.state !== 'dispatched' && !(options.allowCompleted && operation.state === 'completed'))
	) {
		return null;
	}
	const authority = operationAuthority(row.proof_json);
	if (!(await currentDispatchAuthority(tx, operation, authority, clock(), 'verify'))) {
		return null;
	}
	let parentId = operation.parentId;
	const visited = new Set([operation.id]);
	while (parentId !== null) {
		if (visited.has(parentId)) {
			throw new Error('Operation ancestry contains a cycle');
		}
		visited.add(parentId);
		const parent = await tx.one(
			`SELECT parent_id,state FROM agent_operations WHERE id=? AND user_id=?
		 AND app_id=? AND run_id=? AND execution_generation=?`,
			[parentId, input.userId, input.appId, input.runId, operation.scope.executionGeneration],
		);
		if (!parent || (parent.state !== 'dispatched' && parent.state !== 'completed')) {
			return null;
		}
		if (parent.parent_id !== null && typeof parent.parent_id !== 'string') {
			throw new Error('Invalid operation parent identity');
		}
		parentId = parent.parent_id;
	}
	return { operation, authority };
}
