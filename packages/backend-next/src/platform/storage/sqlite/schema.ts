import type { SqlExecutor, SqliteRuntime } from './sqlite-runtime.js';

export interface SchemaMigration {
	readonly version: number;
	/** Immutable marker for the exact published layout at this version. */
	readonly signature: string;
	apply(tx: SqlExecutor): Promise<void>;
}

/** Each migration's DDL and version marker commit in the same SQLite transaction. */
export async function initializeSchema(db: SqliteRuntime, migrations: readonly SchemaMigration[]): Promise<void> {
	const ordered = [...migrations].sort((a, b) => a.version - b.version);
	for (let i = 0; i < ordered.length; i++) {
		if (ordered[i].version !== i + 1 || !ordered[i].signature.trim()) {
			throw new Error('Schema migrations must be contiguous, signed and unique');
		}
	}
	await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version(
      version INTEGER PRIMARY KEY,
      signature TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
	const columns = await db.all('PRAGMA table_info(schema_version)');
	if (!columns.some((column) => column.name === 'signature')) {
		throw new Error('Incompatible pre-release database schema; use a new database');
	}
	const rows = await db.all('SELECT version,signature FROM schema_version ORDER BY version');
	rows.forEach((row, index) => {
		if (
			typeof row.version !== 'number' ||
			row.version !== index + 1 ||
			typeof row.signature !== 'string' ||
			ordered[index]?.signature !== row.signature
		) {
			throw new Error('Incompatible or corrupt database schema version');
		}
	});
	for (const migration of ordered.slice(rows.length)) {
		await db.transaction(async (tx) => {
			const row = await tx.one('SELECT MAX(version) AS version FROM schema_version');
			if ((row?.version ?? null) !== (migration.version === 1 ? null : migration.version - 1)) {
				throw new Error('Schema changed during initialization');
			}
			await migration.apply(tx);
			await tx.run('INSERT INTO schema_version(version,signature,applied_at) VALUES(?,?,?)', [
				migration.version,
				migration.signature,
				Date.now(),
			]);
		});
	}
}
