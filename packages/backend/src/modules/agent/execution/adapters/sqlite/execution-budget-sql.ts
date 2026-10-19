import type { SqlExecutor, SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredExecutionSettings, StoredExecutionUsage } from '../../storage/execution-storage.js';
import { executionDocument, executionInteger } from './execution-row.js';

export async function frozenExecution(tx: SqlReader, runId: string): Promise<StoredExecutionSettings> {
	const row = await tx.one('SELECT settings_json FROM agent_run_execution_settings WHERE run_id=?', [runId]);
	if (!row) {
		throw new Error('Frozen execution settings missing');
	}
	return executionDocument(row.settings_json);
}

export async function executionUsage(tx: SqlExecutor, runId: string, userId: number): Promise<StoredExecutionUsage> {
	const row = await tx.one(
		`SELECT COALESCE(c.parent_id,r.id) AS root_id,
 (SELECT COUNT(*) FROM agent_run_model_steps s WHERE s.run_id=COALESCE(c.parent_id,r.id) OR s.run_id IN (SELECT run_id FROM agent_run_children WHERE parent_id=COALESCE(c.parent_id,r.id))) AS requests,
 (SELECT COUNT(*) FROM agent_run_tools t WHERE t.run_id=COALESCE(c.parent_id,r.id) OR t.run_id IN (SELECT run_id FROM agent_run_children WHERE parent_id=COALESCE(c.parent_id,r.id))) AS tools,
 (SELECT COALESCE(SUM(tokens),0) FROM agent_run_budget_reservations b WHERE b.root_id=COALESCE(c.parent_id,r.id)) AS tokens,
 (SELECT COUNT(*) FROM agent_run_model_steps s JOIN agent_runs owner ON owner.id=s.run_id WHERE owner.user_id=? AND s.state='dispatched') AS calls
 FROM agent_runs r LEFT JOIN agent_run_children c ON c.run_id=r.id WHERE r.id=? AND r.user_id=?`,
		[userId, runId, userId],
	);
	if (!row || typeof row.root_id !== 'string') {
		throw new Error('Execution family usage missing');
	}
	return {
		rootId: row.root_id,
		modelRequests: executionInteger(row.requests),
		toolExecutions: executionInteger(row.tools),
		reservedTokens: executionInteger(row.tokens),
		concurrentModelCalls: executionInteger(row.calls),
	};
}

export async function reserveExecutionTokens(
	tx: SqlExecutor,
	runId: string,
	stepIndex: number,
	rootId: string,
	tokens: number,
): Promise<void> {
	await tx.run('INSERT INTO agent_run_budget_reservations(run_id,step_index,root_id,tokens) VALUES(?,?,?,?)', [
		runId,
		stepIndex,
		rootId,
		tokens,
	]);
}
