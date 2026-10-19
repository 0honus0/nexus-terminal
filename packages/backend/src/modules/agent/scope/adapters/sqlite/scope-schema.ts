import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeAgentScopeSchema(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE agent_apps(
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			definition_id TEXT NOT NULL,
			definition_version TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
			version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
			updated_at INTEGER NOT NULL,
			is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
			created_at INTEGER NOT NULL,
			UNIQUE(id,user_id),
			FOREIGN KEY(definition_id,definition_version) REFERENCES agent_app_definitions(id,version)
		);
		CREATE INDEX agent_apps_owner_idx ON agent_apps(user_id,id);
		CREATE UNIQUE INDEX agent_apps_default_definition ON agent_apps(user_id,definition_id) WHERE is_default=1;
		CREATE TABLE agent_threads(
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			app_id TEXT NOT NULL,
			title TEXT NOT NULL,
			version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(id,user_id,app_id),
			FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id) ON DELETE CASCADE
		);
		CREATE INDEX agent_threads_scope_idx ON agent_threads(user_id,app_id,id);
		CREATE TABLE agent_thread_commands(
			user_id INTEGER NOT NULL,app_id TEXT NOT NULL,operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,
			thread_id TEXT NOT NULL,result_title TEXT NOT NULL,result_version INTEGER NOT NULL CHECK(result_version>=1),
			result_created_at INTEGER NOT NULL,result_updated_at INTEGER NOT NULL,
			PRIMARY KEY(user_id,app_id,operation_id),
			FOREIGN KEY(thread_id,user_id,app_id) REFERENCES agent_threads(id,user_id,app_id)
		);

	`);
}
