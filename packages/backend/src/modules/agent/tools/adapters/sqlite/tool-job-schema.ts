import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeToolJobs(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_tool_jobs(
 id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,app_id TEXT NOT NULL,run_id TEXT NOT NULL,
 connection_id INTEGER NOT NULL CHECK(connection_id>=1),target_version INTEGER NOT NULL CHECK(target_version>=1),
 fingerprint TEXT NOT NULL,policy_revision INTEGER NOT NULL CHECK(policy_revision>=1),
 state TEXT NOT NULL CHECK(state IN ('queued','dispatched','completed','failed','unknown')),
 revision INTEGER NOT NULL CHECK(revision>=1),result_text TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 CHECK(updated_at>=created_at AND created_at>=0),
 CHECK((state IN ('completed','failed') AND result_text IS NOT NULL) OR (state IN ('queued','dispatched','unknown') AND result_text IS NULL)),
 FOREIGN KEY(id,user_id,app_id,run_id) REFERENCES agent_run_tools(id,user_id,app_id,run_id) ON DELETE CASCADE
 );
 CREATE INDEX agent_tool_jobs_scope ON agent_tool_jobs(user_id,app_id,run_id,connection_id,id);`);
}
