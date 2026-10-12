import type { SqlExecutor } from '../sql-types.js';
import type { SchemaVersion } from '../schema-types.js';
import { SqliteFailure } from '../sqlite-errors.js';

/** Technical migration metadata only; never owns a module's business tables. */
export class SqliteSchemaAdapter {
	constructor(private readonly executor: SqlExecutor) {}

	async suspendForeignKeys(): Promise<void> {
		await this.executor.exec('PRAGMA foreign_keys=OFF');
		const row = await this.executor.one('PRAGMA foreign_keys');
		if (row?.foreign_keys !== 0) {
			throw new SqliteFailure('transaction', null, {
				cause: new Error('Failed to suspend SQLite FK enforcement'),
			});
		}
	}

	async restoreForeignKeys(): Promise<void> {
		await this.executor.exec('PRAGMA foreign_keys=ON');
		const row = await this.executor.one('PRAGMA foreign_keys');
		if (row?.foreign_keys !== 1) {
			throw new Error('Failed to restore SQLite FK enforcement');
		}
	}

	async verifyForeignKeys(): Promise<void> {
		const violations = await this.executor.all('PRAGMA foreign_key_check');
		if (violations.length) {
			throw new SqliteFailure('constraint', null, {
				cause: new Error('Referenced table rebuild violates foreign keys'),
			});
		}
	}

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

	async record(version: number, signature: string, appliedAt: number): Promise<void> {
		await this.executor.run('INSERT INTO schema_version(version,signature,applied_at) VALUES(?,?,?)', [
			version,
			signature,
			appliedAt,
		]);
	}
}
