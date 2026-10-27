import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializePreferencesHistory(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE preferences_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('command','path')),
 text TEXT NOT NULL CHECK(length(text)>0),
 recorded_at INTEGER NOT NULL CHECK(recorded_at>=0),
 UNIQUE(user_id,kind,text)
 );
 CREATE INDEX preferences_history_recent ON preferences_history(user_id,kind,recorded_at,id);`);
}
