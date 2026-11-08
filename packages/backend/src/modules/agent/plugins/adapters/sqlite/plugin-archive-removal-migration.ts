import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Remove obsolete Apps and package archives without touching current SDK4 instances or host settings. */
export async function removeArchivedPluginData(tx: SqlExecutor): Promise<void> {
	await tx.exec(`PRAGMA defer_foreign_keys=ON;
	 CREATE TEMP TABLE agent_removed_apps(user_id INTEGER NOT NULL,app_id TEXT NOT NULL,PRIMARY KEY(user_id,app_id));
	 INSERT INTO agent_removed_apps
	 SELECT DISTINCT ref.user_id,ref.app_id FROM agent_plugin_app_packages ref
	 JOIN agent_plugin_versions v ON v.user_id=ref.user_id AND v.definition_id=ref.package_id AND v.version=ref.version
	 WHERE COALESCE(json_extract(v.manifest_json,'$.schemaVersion'),0)<>4;
	 INSERT OR IGNORE INTO agent_removed_apps
	 SELECT a.user_id,a.id FROM agent_apps a WHERE NOT EXISTS
	 (SELECT 1 FROM agent_plugin_installations i WHERE i.user_id=a.user_id AND i.app_id=a.id);
	 CREATE TEMP TABLE agent_removed_packages(user_id INTEGER NOT NULL,package_id TEXT NOT NULL,PRIMARY KEY(user_id,package_id));
	 INSERT INTO agent_removed_packages SELECT p.user_id,p.package_id FROM agent_plugin_packages p
	 JOIN agent_plugin_versions v ON v.user_id=p.user_id AND v.definition_id=p.package_id AND v.version=p.version
	 WHERE COALESCE(json_extract(v.manifest_json,'$.schemaVersion'),0)<>4;`);
	// All scopes are fixed and owned here. No schema discovery or generic cross-module deletion.
	for (const table of [
		'agent_plugin_runtime_instances',
		'agent_plugin_runtime_history',
		'agent_plugin_retirements',
		'agent_plugin_extension_operations',
		'agent_plugin_extension_data',
		'agent_plugin_data_operations',
		'agent_plugin_data_purges',
		'agent_plugin_data_migrations',
		'agent_plugin_data',
		'agent_plugin_instances',
		'agent_plugin_app_packages',
		'agent_plugin_app_bindings',
		'agent_plugin_installations',
	]) {
		await tx.exec(`DELETE FROM ${table} WHERE (user_id,app_id) IN agent_removed_apps;`);
	}
	await tx.exec(`INSERT INTO agent_artifact_blob_removals
	 SELECT id FROM agent_artifacts WHERE (user_id,app_id) IN agent_removed_apps;
	 DELETE FROM agent_artifact_grants WHERE (user_id,receiver_app_id) IN agent_removed_apps
	 OR artifact_id IN (SELECT id FROM agent_artifacts WHERE (user_id,app_id) IN agent_removed_apps);
	 DELETE FROM agent_artifact_attachments WHERE (user_id,target_app_id) IN agent_removed_apps
	 OR artifact_id IN (SELECT id FROM agent_artifacts WHERE (user_id,app_id) IN agent_removed_apps);
	 DELETE FROM agent_artifact_cleanup_items WHERE artifact_id IN
	 (SELECT id FROM agent_artifacts WHERE (user_id,app_id) IN agent_removed_apps);
	 DELETE FROM agent_plugin_intents WHERE (user_id,sender_app_id) IN agent_removed_apps OR (user_id,receiver_app_id) IN agent_removed_apps;
	 DELETE FROM agent_runs WHERE (user_id,app_id) IN agent_removed_apps;
	 DELETE FROM agent_thread_commands WHERE (user_id,app_id) IN agent_removed_apps;
	 DELETE FROM agent_apps WHERE (user_id,id) IN agent_removed_apps;
	 DELETE FROM agent_app_definitions WHERE ((id,version) IN
	 (SELECT ref.definition_id,ref.definition_version FROM agent_app_definition_packages ref
	 JOIN agent_plugin_versions v ON v.user_id=ref.user_id AND v.definition_id=ref.package_id AND v.version=ref.version
	 WHERE COALESCE(json_extract(v.manifest_json,'$.schemaVersion'),0)<>4) OR NOT EXISTS
	 (SELECT 1 FROM agent_app_definition_packages ref WHERE ref.definition_id=agent_app_definitions.id
	 AND ref.definition_version=agent_app_definitions.version)) AND NOT EXISTS
	 (SELECT 1 FROM agent_apps a WHERE a.definition_id=agent_app_definitions.id AND a.definition_version=agent_app_definitions.version);
	 DELETE FROM agent_plugin_package_updates WHERE (user_id,package_id) IN agent_removed_packages
	 OR stage_id IN (SELECT id FROM agent_plugin_stages WHERE manifest_json IS NOT NULL
	 AND COALESCE(json_extract(manifest_json,'$.schemaVersion'),0)<>4);
	 DELETE FROM agent_plugin_packages WHERE (user_id,package_id) IN agent_removed_packages;
	 DELETE FROM agent_plugin_versions WHERE COALESCE(json_extract(manifest_json,'$.schemaVersion'),0)<>4;
	 DROP TABLE agent_plugin_legacy_versions;
	 UPDATE agent_plugin_stages SET status='failed',manifest_json=NULL,publisher_key_id=NULL
	 WHERE status='failed' OR (manifest_json IS NOT NULL AND COALESCE(json_extract(manifest_json,'$.schemaVersion'),0)<>4);
	 DROP TABLE agent_removed_packages;
	 DROP TABLE agent_removed_apps;`);
}
