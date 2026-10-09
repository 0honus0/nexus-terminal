import type { SqliteRuntime } from './sqlite-runtime.js';

/** Platform only owns schema versioning; table DDL belongs to each module. */
export async function initializeSchema(
	db: SqliteRuntime,
	installModules: (db: SqliteRuntime) => Promise<void>,
): Promise<void> {
	await db.exec('CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL)');
	const existing = await db.one('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1');
	if (existing && existing.version !== 1) throw new Error('Unsupported schema version');
	await installModules(db);
	if (!existing) {
		await db.run('INSERT INTO schema_version(version,applied_at) VALUES(?,?)', [1, Date.now()]);
	}
}
