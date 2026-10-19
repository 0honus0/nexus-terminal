import { SqliteRuntime } from '../sqlite-runtime.js';
import { SqliteFailure } from '../sqlite-errors.js';
import type { SqlExecutor, SqlReader } from '../sql-types.js';
import type { SqlParameter, SqlRow } from '../worker-types.js';
import { SnapshotFailure, type SnapshotTable, type SnapshotRegistration } from '../snapshot-types.js';
import { snapshotIdentifier } from './snapshot-row.js';
import { SqliteSchemaAdapter } from './schema-sql.js';

interface ValidationSchema {
	statements: string[];
	preserved: { table: SnapshotTable; rows: SqlRow[] }[];
}

/** Validate against the actual current dialect/constraints without touching the live dataset. */
export class SqliteSnapshotValidation {
	constructor(
		private readonly source: SqliteRuntime,
		private readonly tables: readonly SnapshotTable[],
		private readonly excludedTables: readonly string[],
		private readonly signature: string,
		private readonly maxBytes: number,
		private readonly registrations: readonly SnapshotRegistration[],
	) {}

	private schema(signal: AbortSignal): Promise<ValidationSchema> {
		return this.source.transaction(async (tx) => {
			signal.throwIfAborted();
			const versions = await new SqliteSchemaAdapter(tx).versions();
			if (versions.length !== 1 || versions[0].version !== 1 || versions[0].signature !== this.signature) {
				throw new SnapshotFailure('invalid_registration');
			}
			const expected = new Set([...this.tables.map((table) => table.name), ...this.excludedTables]);
			const declarations = await tx.all(
				"SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name",
			);
			const actual = declarations.filter((row) => row.type === 'table');
			if (
				actual.length !== expected.size ||
				actual.some((row) => typeof row.name !== 'string' || !expected.has(row.name))
			) {
				throw new SnapshotFailure('invalid_registration');
			}
			const statements = declarations.map((row) => {
				if (typeof row.sql !== 'string' || typeof row.tbl_name !== 'string' || !expected.has(row.tbl_name)) {
					throw new SnapshotFailure('invalid_registration');
				}
				return row.sql;
			});
			for (const table of this.tables) {
				signal.throwIfAborted();
				const columns = await tx.all(`PRAGMA table_info(${snapshotIdentifier(table.name)})`);
				if (
					columns.length !== table.columns.length ||
					columns.some((column, index) => column.name !== table.columns[index])
				) {
					throw new SnapshotFailure('invalid_registration');
				}
			}
			const preserved: ValidationSchema['preserved'] = [];
			let bytes = Buffer.byteLength(JSON.stringify(statements));
			if (bytes > this.maxBytes) {
				throw new SnapshotFailure('limit_exceeded');
			}
			for (const name of new Set(this.excludedTables)) {
				signal.throwIfAborted();
				const columns = (await tx.all(`PRAGMA table_info(${snapshotIdentifier(name)})`)).map((column) => {
					if (typeof column.name !== 'string') {
						throw new SnapshotFailure('invalid_registration');
					}
					snapshotIdentifier(column.name);
					return column.name;
				});
				const rows: SqlRow[] = [];
				let after: number | null = null;
				for (;;) {
					signal.throwIfAborted();
					const where = after === null ? '' : ' WHERE rowid>?';
					const page = await tx.all(
						`SELECT rowid AS __snapshot_position,${columns.map(snapshotIdentifier).join(',')} FROM ${snapshotIdentifier(name)}${where} ORDER BY rowid LIMIT 128`,
						after === null ? [] : [after],
					);
					for (const source of page) {
						const position = source.__snapshot_position;
						if (
							typeof position !== 'number' ||
							!Number.isSafeInteger(position) ||
							(after !== null && position <= after)
						) {
							throw new SnapshotFailure('unavailable');
						}
						after = position;
						const row: SqlRow = {};
						for (const column of columns) {
							row[column] = source[column];
						}
						bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
						if (bytes > this.maxBytes) {
							throw new SnapshotFailure('limit_exceeded');
						}
						rows.push(row);
					}
					if (page.length < 128) {
						break;
					}
				}
				preserved.push({ table: { name, columns }, rows });
			}
			return { statements, preserved };
		});
	}

	private async insert(
		tx: SqlExecutor,
		table: SnapshotTable,
		rows: readonly SqlRow[],
		signal: AbortSignal,
	): Promise<void> {
		const declarations = await tx.all(`PRAGMA table_info(${snapshotIdentifier(table.name)})`);
		const types = new Map(declarations.map((column) => [column.name, column]));
		const sql = `INSERT INTO ${snapshotIdentifier(table.name)}(${table.columns.map(snapshotIdentifier).join(',')}) VALUES(${table.columns.map(() => '?').join(',')})`;
		for (const row of rows) {
			signal.throwIfAborted();
			const values: SqlParameter[] = table.columns.map((column) => {
				const value = row[column];
				const declaration = types.get(column);
				if (!declaration) {
					throw new SnapshotFailure('invalid_registration');
				}
				const type = declaration.type;
				// SQLite affinity can coerce invalid input, and non-STRICT INTEGER CHECKs accept some text.
				// Validate the declared representation before SQLite applies affinity.
				if (
					(value === null &&
						(declaration.notnull === 1 || (typeof declaration.pk === 'number' && declaration.pk > 0))) ||
					(value !== null &&
						type === 'INTEGER' &&
						(typeof value !== 'number' || !Number.isSafeInteger(value))) ||
					(value !== null && type === 'TEXT' && typeof value !== 'string')
				) {
					throw new SnapshotFailure('invalid_archive');
				}
				if (
					value !== null &&
					typeof value !== 'string' &&
					(typeof value !== 'number' || !Number.isFinite(value))
				) {
					throw new SnapshotFailure('invalid_archive');
				}
				return value;
			});
			await tx.run(sql, values);
		}
	}

	async validate(rows: ReadonlyMap<string, readonly SqlRow[]>, signal: AbortSignal): Promise<void> {
		let schema: ValidationSchema;
		let staging: SqliteRuntime;
		try {
			schema = await this.schema(signal);
			signal.throwIfAborted();
			staging = SqliteRuntime.openMemory();
		} catch (cause) {
			if (cause instanceof SnapshotFailure || (signal.aborted && cause === signal.reason)) {
				throw cause;
			}
			throw new SnapshotFailure('unavailable', { cause });
		}
		let failure: unknown = null;
		try {
			await staging.transaction(async (tx) => {
				await tx.exec('PRAGMA defer_foreign_keys=ON');
				for (const statement of schema.statements) {
					signal.throwIfAborted();
					await tx.exec(statement);
				}
				for (const entry of schema.preserved) {
					await this.insert(tx, entry.table, entry.rows, signal);
				}
				for (const table of this.tables) {
					const entries = rows.get(table.name);
					if (!entries) {
						throw new SnapshotFailure('invalid_archive');
					}
					await this.insert(tx, table, entries, signal);
				}
				if (await tx.one('PRAGMA foreign_key_check')) {
					throw new SnapshotFailure('invalid_archive');
				}
				const reader: SqlReader = {
					all: (sql, params) => tx.all(sql, params),

					one: (sql, params) => tx.one(sql, params),
				};
				for (const registration of this.registrations) {
					signal.throwIfAborted();
					try {
						await registration.validateStorage?.(
							reader,
							new Map(registration.tables.map((table) => [table.name, rows.get(table.name) ?? []])),
							signal,
						);
					} catch (cause) {
						if (cause instanceof SqliteFailure || (signal.aborted && cause === signal.reason)) {
							throw cause;
						}
						throw new SnapshotFailure('invalid_archive', { cause });
					}
				}
				signal.throwIfAborted();
			});
		} catch (cause) {
			failure = cause;
			if (cause instanceof SnapshotFailure || (signal.aborted && cause === signal.reason)) {
				throw cause;
			}
			throw new SnapshotFailure(
				cause instanceof SqliteFailure && cause.kind === 'constraint' ? 'invalid_archive' : 'unavailable',
				{ cause },
			);
		} finally {
			try {
				await staging.close();
			} catch (cleanup) {
				throw new SnapshotFailure('cleanup_failed', {
					cause:
						failure === null
							? cleanup
							: new AggregateError([failure, cleanup], 'Snapshot preflight and cleanup failed'),
				});
			}
		}
	}
}
