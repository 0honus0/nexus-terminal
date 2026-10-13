import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Additive v10 schema; signed earlier migrations remain unchanged. */
export async function migrateAgentGovernance(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
 CREATE TABLE agent_governance_policies(
   user_id INTEGER NOT NULL, app_id TEXT NOT NULL,
   policy_revision INTEGER NOT NULL DEFAULT 0 CHECK(policy_revision>=0),
   execution_version INTEGER NOT NULL DEFAULT 0 CHECK(execution_version>=0),
   execution_overrides_json TEXT NOT NULL DEFAULT '{}',
   PRIMARY KEY(user_id,app_id),
   FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id) ON DELETE CASCADE
 );
 CREATE TABLE agent_governance_grants(
   user_id INTEGER NOT NULL,app_id TEXT NOT NULL,capability TEXT NOT NULL,
   schema_version INTEGER NOT NULL CHECK(schema_version=2),
   scope_json TEXT NOT NULL,granted_at INTEGER NOT NULL,
   PRIMARY KEY(user_id,app_id,capability),
   FOREIGN KEY(user_id,app_id) REFERENCES agent_governance_policies(user_id,app_id) ON DELETE CASCADE
 );
 CREATE TABLE agent_governance_approvals(
   id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,app_id TEXT NOT NULL,
   run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
   tool_call_id TEXT NOT NULL,operation_hash TEXT NOT NULL CHECK(length(operation_hash)=64),
   kind TEXT NOT NULL CHECK(kind IN ('tool','acp_permission')),
   status TEXT NOT NULL CHECK(status IN ('requested','approved','denied','expired','superseded')),
   policy_revision INTEGER NOT NULL,input_revision INTEGER NOT NULL,
   version INTEGER NOT NULL CHECK(version>=1),requested_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
   decided_at INTEGER,decided_by_user_id INTEGER,consumed_at INTEGER,feedback TEXT,inspection_json TEXT NOT NULL,
   FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id) ON DELETE CASCADE
 );
 CREATE INDEX agent_governance_approval_run ON agent_governance_approvals(user_id,app_id,run_id,requested_at,id);
 CREATE INDEX agent_governance_approval_expiry ON agent_governance_approvals(status,expires_at);
 CREATE TABLE agent_governance_resolution_keys(
   user_id INTEGER NOT NULL,app_id TEXT NOT NULL,operation_key TEXT NOT NULL,
   request_hash TEXT NOT NULL,approval_id TEXT NOT NULL REFERENCES agent_governance_approvals(id) ON DELETE CASCADE,
   result_status TEXT NOT NULL CHECK(result_status IN ('approved','denied')),
   result_version INTEGER NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(user_id,app_id,operation_key)
 );
 `);
}
