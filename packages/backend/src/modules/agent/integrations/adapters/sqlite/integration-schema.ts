import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeAgentIntegrations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_integrations(
 id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,app_id TEXT NOT NULL,configuration_json TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), encrypted_credential TEXT,credential_revision INTEGER NOT NULL,
 schema_hash TEXT,version INTEGER NOT NULL CHECK(version>=1),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id) ON DELETE CASCADE);
 CREATE TABLE agent_integration_intents(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,operation_key TEXT NOT NULL,
 intent_hash TEXT NOT NULL,integration_id TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(user_id,app_id,operation_key),
 FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id) ON DELETE CASCADE);`);
}
