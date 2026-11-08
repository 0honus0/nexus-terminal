import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Move recall policy into existing official tool instances, then remove the former Host policy. */
export async function moveMemoryConfigurationToInstances(tx: SqlExecutor): Promise<void> {
	await tx.exec(`UPDATE agent_plugin_instances SET
	 configuration_json=json_object(
	 'maxRecallItems',min(
	 coalesce((SELECT json_extract(s.settings_json,'$.limits.maxRecallItems') FROM agent_execution_settings s WHERE s.user_id=agent_plugin_instances.user_id),5),
	 coalesce((SELECT json_extract(g.execution_overrides_json,'$.maxRecallItems') FROM agent_governance_policies g WHERE g.user_id=agent_plugin_instances.user_id AND g.app_id=agent_plugin_instances.app_id),9007199254740991)),
	 'maxRecallBytes',min(
	 coalesce((SELECT json_extract(s.settings_json,'$.limits.maxRecallBytes') FROM agent_execution_settings s WHERE s.user_id=agent_plugin_instances.user_id),8192),
	 coalesce((SELECT json_extract(g.execution_overrides_json,'$.maxRecallBytes') FROM agent_governance_policies g WHERE g.user_id=agent_plugin_instances.user_id AND g.app_id=agent_plugin_instances.app_id),9007199254740991))),
	 configuration_revision=1,schema_revision=1
	 WHERE package_id='nexus.tools.agent' AND configuration_revision=0
	 AND EXISTS(SELECT 1 FROM agent_plugin_packages p WHERE p.user_id=agent_plugin_instances.user_id
	 AND p.package_id=agent_plugin_instances.package_id
	 AND p.publisher_key_id='ed25519:617ec64b03cd6ed1a1ddf373e3a47f38666cdcd27753d674e136a4d0a359a1a0');
	 UPDATE agent_execution_settings SET settings_json=json_remove(settings_json,
	 '$.limits.maxRecallItems','$.limits.maxRecallBytes','$.hardLimits.maxRecallItems','$.hardLimits.maxRecallBytes');
	 UPDATE agent_run_execution_settings SET settings_json=json_remove(settings_json,
	 '$.limits.maxRecallItems','$.limits.maxRecallBytes','$.hardLimits.maxRecallItems','$.hardLimits.maxRecallBytes');
	 UPDATE agent_governance_policies SET execution_overrides_json=json_remove(execution_overrides_json,
	 '$.maxRecallItems','$.maxRecallBytes');
	 UPDATE agent_hard_limit_confirmations SET proposed_json=json_remove(proposed_json,'$.maxRecallItems','$.maxRecallBytes');`);
}
