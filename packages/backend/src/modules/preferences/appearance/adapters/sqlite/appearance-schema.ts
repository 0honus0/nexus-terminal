import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializePreferencesAppearance(tx: SqlExecutor): Promise<void> {
	await tx.exec(
		'CREATE TABLE preferences_appearance(user_id INTEGER PRIMARY KEY REFERENCES access_accounts(id) ON DELETE CASCADE,version INTEGER NOT NULL CHECK(version>=1),active_theme_id INTEGER REFERENCES preferences_themes(id),settings_json TEXT NOT NULL,updated_at INTEGER NOT NULL); CREATE INDEX preferences_appearance_active_theme ON preferences_appearance(active_theme_id);',
	);
}
