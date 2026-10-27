import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializePreferencesThemes(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE preferences_themes(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER REFERENCES access_accounts(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>=1),name TEXT NOT NULL,colors_json TEXT NOT NULL,preset_key TEXT UNIQUE,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 CHECK((user_id IS NULL AND preset_key IS NOT NULL) OR (user_id IS NOT NULL AND preset_key IS NULL)));
 CREATE UNIQUE INDEX preferences_themes_user_name ON preferences_themes(user_id,name) WHERE user_id IS NOT NULL;
 CREATE UNIQUE INDEX preferences_themes_preset_name ON preferences_themes(name) WHERE user_id IS NULL;`);
}
