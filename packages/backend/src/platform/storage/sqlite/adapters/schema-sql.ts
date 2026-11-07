import type { SqlExecutor } from '../sql-types.js';
import type { SchemaVersion } from '../schema-types.js';

/** Technical migration metadata only; never owns a module's business tables. */
export class SqliteSchemaAdapter {
	constructor(private readonly executor: SqlExecutor) {}

	async initialize(): Promise<void> {
		await this.executor.exec(`
			CREATE TABLE IF NOT EXISTS schema_version(
				version INTEGER PRIMARY KEY,
				signature TEXT NOT NULL,
				applied_at INTEGER NOT NULL
			)
		`);
		const columns = await this.executor.all('PRAGMA table_info(schema_version)');
		if (!columns.some((column) => column.name === 'signature')) {
			throw new Error('Incompatible pre-release database schema; use a new database');
		}
	}

	async versions(): Promise<SchemaVersion[]> {
		const rows = await this.executor.all('SELECT version,signature FROM schema_version ORDER BY version');
		return rows.map((row) => {
			if (
				typeof row.version !== 'number' ||
				!Number.isSafeInteger(row.version) ||
				row.version < 1 ||
				typeof row.signature !== 'string'
			) {
				throw new Error('Corrupt database schema version');
			}
			return { version: row.version, signature: row.signature };
		});
	}

	async latestVersion(): Promise<number | null> {
		const row = await this.executor.one('SELECT MAX(version) AS version FROM schema_version');
		const version = row?.version ?? null;
		if (version !== null && (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1)) {
			throw new Error('Corrupt database schema version');
		}
		return version;
	}

	async validateMigration(): Promise<void> {
		const enforcement = await this.executor.one('PRAGMA foreign_keys');
		if (enforcement?.foreign_keys !== 1) {
			throw new Error('Schema migration requires foreign key enforcement');
		}
		if (await this.executor.one('PRAGMA foreign_key_check')) {
			throw new Error('Schema migration violates foreign key constraints');
		}
		const deferred = await this.executor.one('PRAGMA defer_foreign_keys');
		if (deferred?.defer_foreign_keys !== 0 && deferred?.defer_foreign_keys !== 1) {
			throw new Error('Invalid schema migration foreign key deferral');
		}
		if (deferred.defer_foreign_keys === 1) {
			// DROP followed by recreation can retain SQLite's deferred violation
			// count after every actual reference is valid. Reset only that count
			// after checking the complete final schema, with enforcement still on.
			await this.executor.exec('PRAGMA defer_foreign_keys=OFF');
		}
	}

	async record(version: number, signature: string, appliedAt: number): Promise<void> {
		await this.executor.run('INSERT INTO schema_version(version,signature,applied_at) VALUES(?,?,?)', [
			version,
			signature,
			appliedAt,
		]);
	}
}
