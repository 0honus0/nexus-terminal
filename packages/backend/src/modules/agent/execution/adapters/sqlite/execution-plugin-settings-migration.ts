import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** App-specific compaction is configured by its plugin; Host quotas retain no unused preference. */
export async function removeHostCompactionPreference(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
UPDATE agent_execution_settings
SET settings_json=json_remove(settings_json,'$.contextCompactionMode')
WHERE json_type(settings_json,'$.contextCompactionMode') IS NOT NULL;
UPDATE agent_run_execution_settings
SET settings_json=json_remove(settings_json,'$.contextCompactionMode')
WHERE json_type(settings_json,'$.contextCompactionMode') IS NOT NULL;
UPDATE agent_governance_policies
SET execution_overrides_json=json_remove(execution_overrides_json,'$.contextCompactionMode')
WHERE json_type(execution_overrides_json,'$.contextCompactionMode') IS NOT NULL;
`);
}
