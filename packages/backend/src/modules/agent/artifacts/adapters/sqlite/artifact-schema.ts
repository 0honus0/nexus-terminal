import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeAgentArtifacts(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_artifacts (
 id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,app_id TEXT NOT NULL,
 name TEXT NOT NULL,media_type TEXT NOT NULL,kind TEXT NOT NULL,size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),
 sha256 TEXT,status TEXT NOT NULL CHECK(status IN ('staging','ready','deleting','deleted','unavailable')),
 retained INTEGER NOT NULL CHECK(retained IN (0,1)),version INTEGER NOT NULL CHECK(version>=1),
 created_at INTEGER NOT NULL,ready_at INTEGER,expires_at INTEGER,deleted_at INTEGER,upload_claimed INTEGER NOT NULL CHECK(upload_claimed IN (0,1)),
 FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id) ON DELETE CASCADE);
 CREATE INDEX agent_artifact_scope ON agent_artifacts(user_id,app_id,status,created_at,id);
 CREATE TABLE agent_artifact_attachments (
 artifact_id TEXT NOT NULL REFERENCES agent_artifacts(id),user_id INTEGER NOT NULL,target_app_id TEXT NOT NULL,thread_id TEXT NOT NULL,run_id TEXT,
 created_at INTEGER NOT NULL,PRIMARY KEY(artifact_id,thread_id),
 FOREIGN KEY(thread_id,user_id,target_app_id) REFERENCES agent_threads(id,user_id,app_id),
 FOREIGN KEY(run_id,user_id,target_app_id) REFERENCES agent_runs(id,user_id,app_id));
 CREATE TABLE agent_artifact_grants (
 receipt_id TEXT NOT NULL REFERENCES agent_plugin_intents(id) ON DELETE CASCADE,
 artifact_id TEXT NOT NULL REFERENCES agent_artifacts(id),user_id INTEGER NOT NULL,receiver_app_id TEXT NOT NULL,
 artifact_version INTEGER NOT NULL CHECK(artifact_version>=1),expires_at INTEGER NOT NULL,revoked_at INTEGER,
 PRIMARY KEY(receipt_id,artifact_id),FOREIGN KEY(receiver_app_id,user_id) REFERENCES agent_apps(id,user_id));
 CREATE INDEX agent_artifact_grant_protection ON agent_artifact_grants(artifact_id,expires_at) WHERE revoked_at IS NULL;
 CREATE TABLE agent_artifact_cleanup (
 id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES access_accounts(id),expires_at INTEGER NOT NULL,consumed_at INTEGER);
 CREATE TABLE agent_artifact_cleanup_items (
 confirmation_id TEXT NOT NULL REFERENCES agent_artifact_cleanup(id) ON DELETE CASCADE,
 artifact_id TEXT NOT NULL REFERENCES agent_artifacts(id),version INTEGER NOT NULL,PRIMARY KEY(confirmation_id,artifact_id));`);
}
