import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function indexApprovalRun(tx: SqlExecutor): Promise<void> {
	await tx.exec('CREATE INDEX agent_approval_run_lookup ON agent_governance_approvals(run_id)');
}

export async function indexApprovalTool(tx: SqlExecutor): Promise<void> {
	await tx.exec('CREATE INDEX agent_approval_tool_lookup ON agent_governance_approvals(tool_call_id)');
}

export async function indexApprovalResolution(tx: SqlExecutor): Promise<void> {
	await tx.exec('CREATE INDEX agent_resolution_approval_lookup ON agent_governance_resolution_keys(approval_id)');
}
