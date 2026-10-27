import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializePreferencesCommands(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE preferences_commands (
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>=1),name TEXT,command TEXT NOT NULL,variables_json TEXT NOT NULL,
 usage_count INTEGER NOT NULL DEFAULT 0 CHECK(usage_count>=0),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 UNIQUE(user_id,id));
 CREATE TABLE preferences_command_tags (
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>=1),name TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 UNIQUE(user_id,id),UNIQUE(user_id,name));
 CREATE TABLE preferences_command_associations (
 user_id INTEGER NOT NULL,command_id INTEGER NOT NULL,tag_id INTEGER NOT NULL,
 PRIMARY KEY(user_id,command_id,tag_id),
 FOREIGN KEY(user_id,command_id) REFERENCES preferences_commands(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,tag_id) REFERENCES preferences_command_tags(user_id,id) ON DELETE CASCADE);
 CREATE INDEX preferences_commands_owner ON preferences_commands(user_id,id);
 CREATE INDEX preferences_command_tags_owner ON preferences_command_tags(user_id,id);`);
}
