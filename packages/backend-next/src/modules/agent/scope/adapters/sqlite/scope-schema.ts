import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeAgentScopeSchema(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE agent_apps(
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			UNIQUE(id,user_id)
		);
		CREATE INDEX agent_apps_owner_idx ON agent_apps(user_id,id);
		CREATE TABLE agent_threads(
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			app_id TEXT NOT NULL,
			title TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			UNIQUE(id,user_id,app_id),
			FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id) ON DELETE CASCADE
		);
		CREATE INDEX agent_threads_scope_idx ON agent_threads(user_id,app_id,id);

	`);
}
