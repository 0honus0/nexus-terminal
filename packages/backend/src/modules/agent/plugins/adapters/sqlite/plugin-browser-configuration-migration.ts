import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Move the former official Browser settings into its existing logical instances once. */
export async function moveBrowserConfigurationToInstances(tx: SqlExecutor): Promise<void> {
	await tx.exec(`UPDATE agent_plugin_instances SET
	 configuration_json=json_object('targets',json((SELECT targets_json FROM agent_browser_configuration b WHERE b.user_id=agent_plugin_instances.user_id))),
	 configuration_revision=1,schema_revision=1
	 WHERE package_id='nexus.tools.browser' AND configuration_revision=0
	 AND EXISTS(SELECT 1 FROM agent_plugin_packages p WHERE p.user_id=agent_plugin_instances.user_id
	 AND p.package_id=agent_plugin_instances.package_id
	 AND p.publisher_key_id='ed25519:617ec64b03cd6ed1a1ddf373e3a47f38666cdcd27753d674e136a4d0a359a1a0')
	 AND EXISTS(SELECT 1 FROM agent_browser_configuration b WHERE b.user_id=agent_plugin_instances.user_id);
	 DROP TABLE agent_browser_configuration;`);
}
