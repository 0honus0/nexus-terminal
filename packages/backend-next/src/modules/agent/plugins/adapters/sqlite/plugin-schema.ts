import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeAgentPlugins(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_repositories(user_id INTEGER PRIMARY KEY REFERENCES access_accounts(id) ON DELETE CASCADE,version INTEGER NOT NULL CHECK(version>=1),repositories_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE agent_plugin_publishers(
 user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,key_id TEXT NOT NULL,
 public_key_pem TEXT NOT NULL,label TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),created_at INTEGER NOT NULL,revoked_at INTEGER,
 PRIMARY KEY(user_id,key_id));
 CREATE TABLE agent_plugin_stages(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
 package_hash TEXT NOT NULL,size_bytes INTEGER NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),
 publisher_key_id TEXT,manifest_json TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE agent_plugin_versions(definition_id TEXT NOT NULL,version TEXT NOT NULL,package_hash TEXT NOT NULL,
 publisher_key_id TEXT NOT NULL,stage_id TEXT NOT NULL REFERENCES agent_plugin_stages(id),manifest_json TEXT NOT NULL,
 PRIMARY KEY(definition_id,version));
 CREATE TABLE agent_plugin_installations(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,definition_id TEXT NOT NULL,
 version TEXT NOT NULL,package_hash TEXT NOT NULL,publisher_key_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('installed','draining','removed')),
 revision INTEGER NOT NULL CHECK(revision>=1),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,definition_id),UNIQUE(user_id,app_id),
 FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id));
 CREATE TABLE agent_plugin_retirements(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,
 stage_id TEXT REFERENCES agent_plugin_stages(id),stage_version INTEGER,created_at INTEGER NOT NULL,base_revision INTEGER NOT NULL CHECK(base_revision>=1),
 PRIMARY KEY(user_id,app_id),FOREIGN KEY(user_id,app_id) REFERENCES agent_plugin_installations(user_id,app_id),
 CHECK((stage_id IS NULL AND stage_version IS NULL) OR (stage_id IS NOT NULL AND stage_version>=1)));
 CREATE TABLE agent_plugin_runtime_instances(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,
 instance_id TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL CHECK(revision>=1),
 state TEXT NOT NULL CHECK(state IN ('opening','active','closed','unknown')),updated_at INTEGER NOT NULL,unknown_at INTEGER,acknowledged_at INTEGER,
 PRIMARY KEY(user_id,app_id),FOREIGN KEY(user_id,app_id) REFERENCES agent_plugin_installations(user_id,app_id));
 CREATE TABLE agent_plugin_runtime_history(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,instance_id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL CHECK(revision>=1),state TEXT NOT NULL CHECK(state='closed'),updated_at INTEGER NOT NULL,
 unknown_at INTEGER,acknowledged_at INTEGER,FOREIGN KEY(user_id,app_id) REFERENCES agent_plugin_installations(user_id,app_id));
 CREATE INDEX agent_plugin_runtime_history_owner ON agent_plugin_runtime_history(user_id,app_id);
 CREATE TABLE agent_plugin_data(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,key TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1),value_json TEXT,updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,app_id,key),FOREIGN KEY(user_id,app_id) REFERENCES agent_plugin_installations(user_id,app_id));
 CREATE TABLE agent_plugin_data_operations(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 content_hash TEXT NOT NULL,key TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),value_json TEXT,updated_at INTEGER NOT NULL,retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1)),
 PRIMARY KEY(user_id,app_id,operation_id),FOREIGN KEY(user_id,app_id) REFERENCES agent_plugin_installations(user_id,app_id));
 CREATE TABLE agent_plugin_data_purges(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 expected_revision INTEGER NOT NULL,result_revision INTEGER NOT NULL,deleted_keys INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,app_id,operation_id),FOREIGN KEY(user_id,app_id) REFERENCES agent_plugin_installations(user_id,app_id));
 CREATE TABLE agent_plugin_data_migrations(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,result_revision INTEGER NOT NULL,changed_keys INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,app_id,operation_id),FOREIGN KEY(user_id,app_id) REFERENCES agent_plugin_installations(user_id,app_id));`);
}
