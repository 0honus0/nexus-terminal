import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredToolOperation } from '../../storage/run-tool-storage.js';
import { toolOperation } from './run-tool-row.js';

/** A nested operation remains attached to the exact dispatched parent, never a reused model proposal. */
export async function currentAcpParent(tx: SqlExecutor, operation: StoredToolOperation): Promise<boolean> {
	const link = await tx.one('SELECT parent_id,parent_hash FROM agent_acp_permissions WHERE tool_id=?', [
		operation.id,
	]);
	if (!link) {
		return operation.toolName !== 'acp_inner_permission';
	}
	if (
		typeof link.parent_id !== 'string' ||
		typeof link.parent_hash !== 'string' ||
		operation.toolName !== 'acp_inner_permission'
	) {
		throw new Error('Corrupt ACP parent relation');
	}
	const parent = await toolOperation(tx, operation.userId, operation.appId, operation.runId, link.parent_id);
	return (
		parent !== null &&
		parent.state === 'dispatched' &&
		parent.toolName === 'acp_execute' &&
		parent.operationHash === link.parent_hash &&
		parent.targetId === operation.targetId &&
		parent.targetVersion === operation.targetVersion &&
		parent.modelStepIndex === operation.modelStepIndex &&
		parent.capability === operation.capability
	);
}
