import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializePreferencesFavorites(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE preferences_favorites (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>=1),
 name TEXT, path TEXT NOT NULL, last_used_at INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
 CREATE INDEX preferences_favorites_owner ON preferences_favorites(user_id,id);`);
}
