import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Safe diagnostic facts are independent of whether the external effect is confirmed. */
export async function initializeOperationDiagnostics(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_operation_diagnostics (
 operation_id TEXT PRIMARY KEY REFERENCES agent_operations(id) ON DELETE CASCADE,
 code TEXT NOT NULL
 ) STRICT`);
}
