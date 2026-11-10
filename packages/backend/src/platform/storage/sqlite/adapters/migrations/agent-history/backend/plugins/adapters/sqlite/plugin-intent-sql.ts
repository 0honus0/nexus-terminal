// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

export async function initializePluginIntents(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_intents (
	 id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,sender_app_id TEXT NOT NULL,receiver_app_id TEXT NOT NULL,
	 sender_version TEXT NOT NULL,receiver_version TEXT NOT NULL,sender_revision TEXT NOT NULL,receiver_revision TEXT NOT NULL,intent_id TEXT NOT NULL,schema_version INTEGER NOT NULL CHECK(schema_version>=1),
	 input_json TEXT NOT NULL,artifact_ids_json TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER,
	 FOREIGN KEY(sender_app_id,user_id) REFERENCES agent_apps(id,user_id),
	 FOREIGN KEY(receiver_app_id,user_id) REFERENCES agent_apps(id,user_id));
	 CREATE INDEX agent_plugin_intent_inbox ON agent_plugin_intents(user_id,receiver_app_id,expires_at,created_at,id);`);
}
