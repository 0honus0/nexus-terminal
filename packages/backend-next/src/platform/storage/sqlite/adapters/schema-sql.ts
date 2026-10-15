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

	async record(version: number, signature: string, appliedAt: number): Promise<void> {
		await this.executor.run('INSERT INTO schema_version(version,signature,applied_at) VALUES(?,?,?)', [
			version,
			signature,
			appliedAt,
		]);
	}
}
