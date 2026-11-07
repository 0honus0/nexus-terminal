import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Historical frozen inputs have no signed policy binding and can never execute again. */
export async function persistRunAppExecution(tx: SqlExecutor): Promise<void> {
	await tx.exec(
		`ALTER TABLE agent_run_frozen_inputs ADD COLUMN app_execution_json TEXT NOT NULL DEFAULT '{"kind":"retired"}'`,
	);
}
