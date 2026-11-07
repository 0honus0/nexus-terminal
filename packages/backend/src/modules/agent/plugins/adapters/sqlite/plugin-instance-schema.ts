import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function fenceClearedPluginConfigurationReceipts(tx: SqlExecutor): Promise<void> {
	await tx.exec(
		'ALTER TABLE agent_plugin_configuration_mutations ADD COLUMN retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1))',
	);
}

export async function initializePluginInstances(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_instances (
	 id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,app_id TEXT NOT NULL,package_id TEXT NOT NULL,
	 name TEXT NOT NULL,selected INTEGER NOT NULL CHECK(selected IN (0,1)),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
	 revision INTEGER NOT NULL CHECK(revision>=1),configuration_revision INTEGER NOT NULL CHECK(configuration_revision>=0),
	 schema_revision INTEGER NOT NULL CHECK(schema_revision>=0),configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
	 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
	 UNIQUE(user_id,app_id,id),
	 FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id) ON DELETE CASCADE,
	 FOREIGN KEY(user_id,package_id) REFERENCES agent_plugin_packages(user_id,package_id)
	) STRICT;
	CREATE INDEX agent_plugin_instances_app ON agent_plugin_instances(user_id,app_id,package_id);
	CREATE TABLE agent_plugin_configuration_mutations (
	 user_id INTEGER NOT NULL,app_id TEXT NOT NULL,instance_id TEXT NOT NULL,
	 caller_id TEXT NOT NULL,operation_key TEXT NOT NULL,request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
	 result_json TEXT NOT NULL CHECK(json_valid(result_json)),created_at INTEGER NOT NULL,
	 PRIMARY KEY(instance_id,caller_id,operation_key),
	 FOREIGN KEY(user_id,app_id,instance_id) REFERENCES agent_plugin_instances(user_id,app_id,id) ON DELETE CASCADE
	) STRICT;`);
	await tx.exec(`INSERT INTO agent_plugin_instances
	 (id,user_id,app_id,package_id,name,selected,enabled,revision,configuration_revision,schema_revision,configuration_json,created_at,updated_at)
	 SELECT CASE WHEN ref.kind='app' THEN ref.app_id ELSE
	 lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||
	 '-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))) END,
	 ref.user_id,ref.app_id,ref.package_id,ref.package_id,ref.selected_root,1,1,0,
	 COALESCE(json_extract(v.manifest_json,'$.contributions.settings.schemaRevision'),0),
	 COALESCE(json_extract(v.manifest_json,'$.contributions.settings.defaultsJson'),'{}'),i.created_at,i.updated_at
	 FROM agent_plugin_app_packages ref JOIN agent_plugin_installations i ON i.user_id=ref.user_id AND i.app_id=ref.app_id
	 JOIN agent_plugin_versions v ON v.user_id=ref.user_id AND v.definition_id=ref.package_id AND v.version=ref.version
	 WHERE ref.kind<>'ui' OR NOT EXISTS(SELECT 1 FROM agent_plugin_app_packages other WHERE
	 other.user_id=ref.user_id AND other.app_id=ref.app_id AND other.package_id=ref.package_id AND other.kind<>'ui');`);
}
