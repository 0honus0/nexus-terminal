import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeBrowserConfiguration(tx: SqlExecutor): Promise<void> {
	await tx.exec(
		'CREATE TABLE agent_browser_configuration(user_id INTEGER PRIMARY KEY REFERENCES access_accounts(id) ON DELETE CASCADE,version INTEGER NOT NULL CHECK(version>=1),targets_json TEXT NOT NULL)',
	);
}
