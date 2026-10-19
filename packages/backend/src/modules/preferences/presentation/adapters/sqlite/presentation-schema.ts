import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializePreferencesPresentation(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE preferences_presentation (
 user_id INTEGER PRIMARY KEY REFERENCES access_accounts(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>=1),value_json TEXT NOT NULL);`);
}
