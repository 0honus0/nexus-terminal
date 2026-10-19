import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeAgentExecution(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_execution_settings(user_id INTEGER PRIMARY KEY REFERENCES access_accounts(id) ON DELETE CASCADE,version INTEGER NOT NULL CHECK(version>=1),settings_json TEXT NOT NULL);
 CREATE TABLE agent_hard_limit_confirmations(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,expected_version INTEGER NOT NULL CHECK(expected_version>=0),proposed_json TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER);
 CREATE TABLE agent_run_execution_settings(run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,settings_json TEXT NOT NULL);
 CREATE TABLE agent_run_budget_reservations(run_id TEXT NOT NULL,step_index INTEGER NOT NULL,root_id TEXT NOT NULL REFERENCES agent_runs(id),tokens INTEGER NOT NULL CHECK(tokens>=1),PRIMARY KEY(run_id,step_index),FOREIGN KEY(run_id,step_index) REFERENCES agent_run_model_steps(run_id,step_index) ON DELETE CASCADE);`);
}
