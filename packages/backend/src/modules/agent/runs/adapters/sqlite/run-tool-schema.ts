import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeRunTools(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
 CREATE TABLE agent_run_tools(
  id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,app_id TEXT NOT NULL,
  run_id TEXT NOT NULL,model_step_index INTEGER NOT NULL CHECK(model_step_index>=1),
  provider_call_id TEXT NOT NULL,tool_name TEXT NOT NULL,tool_version TEXT NOT NULL,capability TEXT NOT NULL,
  target_id INTEGER CHECK(target_id>=1),target_version INTEGER CHECK(target_version>=1),
  risk TEXT NOT NULL CHECK(risk IN ('read','control','mutate','destructive','forbidden')),
  mutation INTEGER NOT NULL CHECK(mutation IN (0,1)),summary TEXT NOT NULL,
  arguments_json TEXT NOT NULL,operation_hash TEXT NOT NULL CHECK(length(operation_hash)=64),
  operation_revision INTEGER NOT NULL CHECK(operation_revision>=1),revision INTEGER NOT NULL CHECK(revision>=1),
  state TEXT NOT NULL CHECK(state IN ('inspected','dispatched','completed','failed','unknown','cancelled')),
  result_text TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
  CHECK((target_id IS NULL)=(target_version IS NULL)),
  CHECK(revision>=operation_revision),
  CHECK(created_at>=0 AND updated_at>=created_at),
  CHECK(state NOT IN ('inspected','dispatched') OR result_text IS NULL),
  CHECK(state!='completed' OR result_text IS NOT NULL),
  UNIQUE(run_id,model_step_index,provider_call_id),
  UNIQUE(id,user_id,app_id,run_id),
  FOREIGN KEY(run_id,user_id,app_id) REFERENCES agent_runs(id,user_id,app_id) ON DELETE CASCADE,
  FOREIGN KEY(run_id,model_step_index) REFERENCES agent_run_model_steps(run_id,step_index) ON DELETE CASCADE,
  FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id) ON DELETE CASCADE
 );
 CREATE INDEX agent_run_tools_scope ON agent_run_tools(user_id,app_id,run_id,id);
 CREATE TABLE agent_acp_permissions(
  tool_id TEXT PRIMARY KEY REFERENCES agent_run_tools(id) ON DELETE CASCADE,
  parent_id TEXT NOT NULL REFERENCES agent_run_tools(id) ON DELETE CASCADE,
  parent_hash TEXT NOT NULL CHECK(length(parent_hash)=64),
  request_key TEXT NOT NULL,
  CHECK(tool_id!=parent_id),UNIQUE(parent_id,request_key)
 );
 CREATE INDEX agent_acp_permissions_parent ON agent_acp_permissions(parent_id,tool_id);
 CREATE TABLE agent_run_tool_events(
  tool_call_id TEXT NOT NULL REFERENCES agent_run_tools(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision>=1),operation_revision INTEGER NOT NULL CHECK(operation_revision>=1),
  state TEXT NOT NULL CHECK(state IN ('inspected','dispatched','completed','failed','unknown','cancelled')),
  operation_hash TEXT NOT NULL CHECK(length(operation_hash)=64),created_at INTEGER NOT NULL,
  PRIMARY KEY(tool_call_id,revision)
 );
 `);
}
