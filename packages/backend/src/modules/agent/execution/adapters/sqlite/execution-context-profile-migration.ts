import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** These settings documents have no content hash; immutable Run inputs and journals remain untouched. */
export async function removeUnusedContextProfile(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
UPDATE agent_execution_settings
SET settings_json=json_remove(settings_json,'$.contextProfile')
WHERE json_type(settings_json,'$.contextProfile') IS NOT NULL;
UPDATE agent_governance_policies
SET execution_overrides_json=json_remove(execution_overrides_json,'$.contextProfile')
WHERE json_type(execution_overrides_json,'$.contextProfile') IS NOT NULL;
UPDATE agent_run_execution_settings
SET settings_json=json_remove(settings_json,'$.contextProfile')
WHERE json_type(settings_json,'$.contextProfile') IS NOT NULL;
`);
}
