import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function bindProjectEffectsToOperations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`ALTER TABLE agent_project_effects RENAME TO agent_legacy_project_effects;
	 CREATE TABLE agent_project_effects(
	 operation_id TEXT PRIMARY KEY REFERENCES agent_operations(id) ON DELETE CASCADE
	 ) STRICT;`);
}
