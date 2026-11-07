import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializePluginConnections(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_connections(
	 instance_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,app_id TEXT NOT NULL,
	 revision INTEGER NOT NULL CHECK(revision>=1),connector_json TEXT NOT NULL CHECK(json_valid(connector_json)),
	 encrypted_credential TEXT,updated_at INTEGER NOT NULL,
	 FOREIGN KEY(user_id,app_id,instance_id) REFERENCES agent_plugin_instances(user_id,app_id,id) ON DELETE CASCADE
	) STRICT;`);
}
