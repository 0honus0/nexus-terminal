import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeAgentMemory(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_memories (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, app_id TEXT NOT NULL,
 content TEXT NOT NULL, confidence REAL NOT NULL CHECK(confidence>=0 AND confidence<=1),
 status TEXT NOT NULL CHECK(status IN ('candidate','published','revoked')),
 source_run_id TEXT, expires_at INTEGER, review_action TEXT, reviewed_at INTEGER,
 version INTEGER NOT NULL CHECK(version>=1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(source_run_id,user_id,app_id) REFERENCES agent_runs(id,user_id,app_id),
 CHECK((status='candidate' AND review_action IS NULL AND reviewed_at IS NULL)
 OR (status='published' AND review_action='publish' AND reviewed_at IS NOT NULL)
 OR (status='revoked' AND review_action IN ('reject','revoke') AND reviewed_at IS NOT NULL)));
 CREATE INDEX agent_memory_scope ON agent_memories(user_id,app_id,status,id);
 CREATE TABLE agent_memory_imports (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, app_id TEXT NOT NULL,
 memory_id TEXT NOT NULL UNIQUE, source_app_id TEXT NOT NULL, source_memory_id TEXT NOT NULL,
 source_version INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER,
 FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id) ON DELETE CASCADE);
 CREATE INDEX agent_memory_import_expiry ON agent_memory_imports(expires_at);`);
}
