import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializePreferencesBackgrounds(tx: SqlExecutor): Promise<void> {
	await tx.exec(
		`CREATE TABLE preferences_backgrounds(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES access_accounts(id),kind TEXT NOT NULL CHECK(kind IN('page','terminal')),media_type TEXT NOT NULL,size_bytes INTEGER NOT NULL CHECK(size_bytes>0),sha256 TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('pending','ready','retired')));CREATE INDEX preferences_backgrounds_status ON preferences_backgrounds(status);CREATE INDEX preferences_backgrounds_owner ON preferences_backgrounds(user_id);`,
	);
}
