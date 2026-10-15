import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializePreferencesHtmlThemes(tx: SqlExecutor): Promise<void> {
	await tx.exec(
		'CREATE TABLE preferences_html_revisions(user_id INTEGER PRIMARY KEY REFERENCES access_accounts(id) ON DELETE CASCADE,version INTEGER NOT NULL CHECK(version>=1)); CREATE TABLE preferences_html_themes(user_id INTEGER NOT NULL REFERENCES access_accounts(id) ON DELETE CASCADE,name TEXT NOT NULL,content TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,name));',
	);
}
