// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

export async function scopePluginVersionsToUsers(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_versions_scoped(
	 user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
	 definition_id TEXT NOT NULL,version TEXT NOT NULL,package_hash TEXT NOT NULL,publisher_key_id TEXT NOT NULL,
	 stage_id TEXT NOT NULL REFERENCES agent_plugin_stages(id),manifest_json TEXT NOT NULL,
	 PRIMARY KEY(user_id,definition_id,version));
	 INSERT INTO agent_plugin_versions_scoped SELECT owner.user_id,v.definition_id,v.version,v.package_hash,v.publisher_key_id,
	 COALESCE((SELECT s.id FROM agent_plugin_stages s WHERE s.user_id=owner.user_id AND s.package_hash=v.package_hash AND s.publisher_key_id=v.publisher_key_id ORDER BY s.updated_at DESC,s.id DESC LIMIT 1),v.stage_id),v.manifest_json
	 FROM agent_plugin_versions v JOIN
	 (SELECT s.user_id,v.definition_id,v.version FROM agent_plugin_versions v JOIN agent_plugin_stages s ON s.id=v.stage_id
	 UNION SELECT user_id,definition_id,version FROM agent_plugin_installations) owner
	 ON owner.definition_id=v.definition_id AND owner.version=v.version;
	 DROP TABLE agent_plugin_versions;
	 ALTER TABLE agent_plugin_versions_scoped RENAME TO agent_plugin_versions;`);
}

export async function initializePluginPackageInstallations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_packages(
	 user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,package_id TEXT NOT NULL,
	 version TEXT NOT NULL,package_hash TEXT NOT NULL,publisher_key_id TEXT NOT NULL,
	 status TEXT NOT NULL CHECK(status IN ('installed','draining','removed','incompatible')),
	 revision INTEGER NOT NULL CHECK(revision>=1),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
	 PRIMARY KEY(user_id,package_id),
	 FOREIGN KEY(user_id,package_id,version) REFERENCES agent_plugin_versions(user_id,definition_id,version));
	 INSERT INTO agent_plugin_packages SELECT user_id,definition_id,version,package_hash,publisher_key_id,
	 CASE WHEN status='removed' THEN 'removed' ELSE 'incompatible' END,revision,created_at,updated_at FROM agent_plugin_installations;`);
}

export async function separatePluginAppInstallations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`PRAGMA defer_foreign_keys=ON;
	 CREATE TABLE agent_plugin_installations_composed(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,definition_id TEXT NOT NULL,
	 version TEXT NOT NULL,package_hash TEXT NOT NULL,publisher_key_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('installed','draining','removed')),
	 revision INTEGER NOT NULL CHECK(revision>=1),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
	 PRIMARY KEY(user_id,app_id),FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id));
	 INSERT INTO agent_plugin_installations_composed SELECT * FROM agent_plugin_installations;
	 DROP TABLE agent_plugin_installations;
	 ALTER TABLE agent_plugin_installations_composed RENAME TO agent_plugin_installations;`);
}

export async function initializePluginAppBindings(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_app_bindings(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,
	 execution_revision INTEGER NOT NULL CHECK(execution_revision>=1),ui_revision INTEGER NOT NULL CHECK(ui_revision>=1),
	 PRIMARY KEY(user_id,app_id),FOREIGN KEY(user_id,app_id) REFERENCES agent_plugin_installations(user_id,app_id));
	 INSERT INTO agent_plugin_app_bindings SELECT user_id,app_id,revision,revision FROM agent_plugin_installations;`);
}

export async function initializePluginAppPackageReferences(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_app_packages(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,package_id TEXT NOT NULL,
	 kind TEXT NOT NULL CHECK(kind IN ('app','tool','ui')),version TEXT NOT NULL,package_hash TEXT NOT NULL,publisher_key_id TEXT NOT NULL,
	 PRIMARY KEY(user_id,app_id,package_id,kind),
	 FOREIGN KEY(user_id,app_id) REFERENCES agent_plugin_app_bindings(user_id,app_id),
	 FOREIGN KEY(user_id,package_id) REFERENCES agent_plugin_packages(user_id,package_id));
	 INSERT INTO agent_plugin_app_packages SELECT user_id,app_id,definition_id,'app',version,package_hash,publisher_key_id FROM agent_plugin_installations;`);
}

export async function archiveLegacyPluginPackages(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_legacy_versions(user_id INTEGER NOT NULL,definition_id TEXT NOT NULL,version TEXT NOT NULL,
	 package_hash TEXT NOT NULL,publisher_key_id TEXT NOT NULL,stage_id TEXT NOT NULL REFERENCES agent_plugin_stages(id),source_user_id INTEGER NOT NULL REFERENCES access_accounts(id),size_bytes INTEGER NOT NULL,manifest_json TEXT NOT NULL,
	 PRIMARY KEY(user_id,definition_id,version),FOREIGN KEY(user_id) REFERENCES access_accounts(id));
	 INSERT INTO agent_plugin_legacy_versions SELECT v.user_id,v.definition_id,v.version,v.package_hash,v.publisher_key_id,v.stage_id,s.user_id,s.size_bytes,v.manifest_json FROM agent_plugin_versions v JOIN agent_plugin_stages s ON s.id=v.stage_id WHERE json_extract(v.manifest_json,'$.schemaVersion')<>2;
	 UPDATE agent_plugin_versions SET manifest_json=json_object('format','legacy-archive','packageId',definition_id,'version',version,
	 'displayName',json_extract(manifest_json,'$.displayName'),'capabilities',json(json_extract(manifest_json,'$.capabilities')))
	 WHERE json_extract(manifest_json,'$.schemaVersion')<>2;`);
}

export async function fenceLegacyPluginPackages(tx: SqlExecutor): Promise<void> {
	// Original signed bytes and historical records remain intact. Old code is never silently re-signed or executed.
	await tx.exec(`UPDATE agent_apps SET enabled=0 WHERE (user_id,id) IN
	 (SELECT i.user_id,i.app_id FROM agent_plugin_installations i JOIN agent_plugin_versions v
	 ON v.user_id=i.user_id AND v.definition_id=i.definition_id AND v.version=i.version
	 WHERE json_extract(v.manifest_json,'$.format')='legacy-archive');
	 UPDATE agent_plugin_installations SET status='removed' WHERE (user_id,definition_id,version) IN
	 (SELECT user_id,definition_id,version FROM agent_plugin_versions WHERE json_extract(manifest_json,'$.format')='legacy-archive');
	 UPDATE agent_plugin_stages SET status='failed',manifest_json=NULL,publisher_key_id=NULL
	 WHERE manifest_json IS NOT NULL AND json_extract(manifest_json,'$.schemaVersion')<>2;
	 DELETE FROM agent_plugin_retirements WHERE (user_id,app_id) IN
	 (SELECT user_id,app_id FROM agent_plugin_installations WHERE status='removed');`);
}

export async function scopePluginRuntimeInstances(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_runtime_instances_scoped(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,package_id TEXT NOT NULL,
	 instance_id TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL CHECK(revision>=1),state TEXT NOT NULL CHECK(state IN ('opening','active','closed','unknown')),
	 updated_at INTEGER NOT NULL,unknown_at INTEGER,acknowledged_at INTEGER,PRIMARY KEY(user_id,app_id,package_id),
	 FOREIGN KEY(user_id,app_id) REFERENCES agent_plugin_installations(user_id,app_id));
	 INSERT INTO agent_plugin_runtime_instances_scoped SELECT r.user_id,r.app_id,i.definition_id,r.instance_id,r.revision,r.state,r.updated_at,r.unknown_at,r.acknowledged_at
	 FROM agent_plugin_runtime_instances r JOIN agent_plugin_installations i ON i.user_id=r.user_id AND i.app_id=r.app_id;
	 DROP TABLE agent_plugin_runtime_instances;
	 ALTER TABLE agent_plugin_runtime_instances_scoped RENAME TO agent_plugin_runtime_instances;`);
}

export async function scopePluginRuntimeHistory(tx: SqlExecutor): Promise<void> {
	await tx.exec(`ALTER TABLE agent_plugin_runtime_history ADD COLUMN package_id TEXT NOT NULL DEFAULT '';
	 UPDATE agent_plugin_runtime_history SET package_id=(SELECT definition_id FROM agent_plugin_installations i
	 WHERE i.user_id=agent_plugin_runtime_history.user_id AND i.app_id=agent_plugin_runtime_history.app_id);`);
}

export async function initializePluginExtensionData(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_extension_data(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,package_id TEXT NOT NULL,key TEXT NOT NULL,
	 version INTEGER NOT NULL CHECK(version>=1),value_json TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,app_id,package_id,key),
	 FOREIGN KEY(user_id,app_id) REFERENCES agent_plugin_app_bindings(user_id,app_id),
	 FOREIGN KEY(user_id,package_id) REFERENCES agent_plugin_packages(user_id,package_id));`);
}

export async function initializePluginExtensionOperations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_extension_operations(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,package_id TEXT NOT NULL,operation_id TEXT NOT NULL,
	 content_hash TEXT NOT NULL,key TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),value_json TEXT,updated_at INTEGER NOT NULL,
	 retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1)),PRIMARY KEY(user_id,app_id,package_id,operation_id),
	 FOREIGN KEY(user_id,app_id) REFERENCES agent_plugin_app_bindings(user_id,app_id),
	 FOREIGN KEY(user_id,package_id) REFERENCES agent_plugin_packages(user_id,package_id));`);
}

export async function initializePluginPackageUpdates(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_package_updates(user_id INTEGER NOT NULL,package_id TEXT NOT NULL,
	 stage_id TEXT NOT NULL REFERENCES agent_plugin_stages(id),stage_version INTEGER NOT NULL CHECK(stage_version>=1),created_at INTEGER NOT NULL,
	 PRIMARY KEY(user_id,package_id),FOREIGN KEY(user_id,package_id) REFERENCES agent_plugin_packages(user_id,package_id));`);
}

export async function fenceMigratedPluginPackageUpdates(tx: SqlExecutor): Promise<void> {
	await tx.exec(
		'ALTER TABLE agent_plugin_package_updates ADD COLUMN data_migrated INTEGER NOT NULL DEFAULT 0 CHECK(data_migrated IN (0,1));',
	);
}
