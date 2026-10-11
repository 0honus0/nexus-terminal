import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Desktop recent-connection metadata does not change configuration version. */
export async function initializeDesktopConnectionHistory(tx: SqlExecutor): Promise<void> {
	await tx.exec('ALTER TABLE connections ADD COLUMN last_connected_at INTEGER');
}
