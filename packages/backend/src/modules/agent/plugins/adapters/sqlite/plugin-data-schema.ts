import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializePluginPrivateData(tx: SqlExecutor): Promise<void> {
	await tx.run(`CREATE TABLE agent_plugin_private_data (
	 user_id INTEGER NOT NULL,
	 app_id TEXT NOT NULL,
	 publisher_key_id TEXT NOT NULL,
	 package_id TEXT NOT NULL,
	 instance_id TEXT NOT NULL,
	 namespace TEXT NOT NULL,
	 key TEXT NOT NULL,
	 revision INTEGER NOT NULL CHECK(revision>0),
	 document_json TEXT CHECK(document_json IS NULL OR json_valid(document_json)),
	 updated_at INTEGER NOT NULL,
	 PRIMARY KEY(user_id,app_id,publisher_key_id,package_id,instance_id,namespace,key),
	 FOREIGN KEY(user_id,app_id,instance_id) REFERENCES agent_plugin_instances(user_id,app_id,id) ON DELETE CASCADE
	) STRICT`);
}
