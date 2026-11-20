import { sql, type Kysely, type QueryExecutorProvider } from 'kysely';
import type { MigrationProvider } from 'kysely/migration';
import { pluginTablePrefix, type DatabaseApi } from '../../database/node/database-api.js';
import { CodedError } from '../../utils/error.js';
import { BackupDeclarationSchema, type BackupDeclaration, type BackupTable } from '../backup-types.js';

const registry = 'nexus_backup_declarations';

export type BackupRow = Record<string, string | number | null | Uint8Array>;

export type BackupTables = Record<string, BackupRow>;

type RegistryTables = { [registry]: { id: string; version: string; tables: string } };

interface BackupRegistration {
	id: string;
	version: string;
	tables: BackupDeclaration;
}

const migrations: MigrationProvider = {
	async getMigrations() {
		return {
			'001_declarations': {
				async up(db) {
					await db.schema
						.createTable(registry)
						.addColumn('id', 'text', (column) => column.primaryKey())
						.addColumn('version', 'text', (column) => column.notNull())
						.addColumn('tables', 'text', (column) => column.notNull())
						.execute();
				},
			},
		};
	},
};

export function backupTableName(pluginId: string, { table }: BackupTable): string {
	return pluginTablePrefix(pluginId) + table;
}

export async function verifyBackupTable(db: QueryExecutorProvider, name: string, table: BackupTable): Promise<void> {
	const entry = await sql<{ type: string }>`select type from sqlite_schema where name = ${name}`.execute(db);
	const { rows: columns } = await sql<{
		name: string;
		pk: number;
	}>`select name, pk from pragma_table_info(${name})`.execute(db);
	const primary = columns
		.filter(({ pk }) => pk > 0)
		.sort((a, b) => a.pk - b.pk)
		.map(({ name }) => name);

	const matches = (key: readonly (string | null)[]) =>
		key.length === table.keys.length &&
		new Set(key).size === key.length &&
		key.every((column) => column !== null && table.keys.includes(column));

	if (
		entry.rows[0]?.type !== 'table' ||
		Object.keys(table.fields).some((key) => !columns.some(({ name }) => name === key))
	)
		throw new CodedError('BACKUP_TABLE_INVALID');
	if (matches(primary)) return;
	const indexes = await sql<{
		name: string;
	}>`select name from pragma_index_list(${name}) where "unique" = 1 and partial = 0`.execute(db);
	for (const index of indexes.rows) {
		const { rows } = await sql<{ name: string | null }>`select name from pragma_index_info(${index.name})`.execute(
			db,
		);
		if (matches(rows.map(({ name }) => name))) return;
	}
	throw new CodedError('BACKUP_TABLE_INVALID');
}

type BackupDatabase = Pick<DatabaseApi, 'withClient' | 'migrateHost' | 'clearPluginData'>;

export class BackupStorage {
	readonly #database: BackupDatabase;

	constructor(database: BackupDatabase) {
		this.#database = database;
	}

	initialize(signal: AbortSignal): Promise<void> {
		return this.#database.migrateHost('nexus_backup', migrations, signal);
	}

	async register(pluginId: string, version: string, tables: BackupDeclaration, signal: AbortSignal): Promise<void> {
		await this.#database.withClient((client) =>
			client
				.$extendTables<RegistryTables>()
				.transaction()
				.execute(async (db) => {
					signal.throwIfAborted();
					if (!tables.length) {
						await db.deleteFrom(registry).where('id', '=', pluginId).execute();
						return;
					}

					for (const table of tables) await verifyBackupTable(db, backupTableName(pluginId, table), table);
					signal.throwIfAborted();
					const serialized = JSON.stringify(tables);
					await db
						.insertInto(registry)
						.values({ id: pluginId, version, tables: serialized })
						.onConflict((conflict) => conflict.column('id').doUpdateSet({ version, tables: serialized }))
						.execute();
					signal.throwIfAborted();
				}),
		);
	}

	clearPluginData(pluginId: string, signal: AbortSignal): Promise<void> {
		return this.#database.clearPluginData(pluginId, signal, async (db) => {
			await db.$extendTables<RegistryTables>().deleteFrom(registry).where('id', '=', pluginId).execute();
		});
	}

	/** 导出与恢复从调用方的事务读取登记记录和插件数据。 */
	async list(db: Kysely<BackupTables>): Promise<BackupRegistration[]> {
		const rows = await db.$extendTables<RegistryTables>().selectFrom(registry).selectAll().orderBy('id').execute();
		return rows.map(({ tables, ...row }) => ({
			...row,
			tables: BackupDeclarationSchema.parse(JSON.parse(tables)),
		}));
	}

	async get(db: Kysely<BackupTables>, pluginId: string): Promise<BackupRegistration | undefined> {
		const row = await db
			.$extendTables<RegistryTables>()
			.selectFrom(registry)
			.selectAll()
			.where('id', '=', pluginId)
			.executeTakeFirst();
		return row && { ...row, tables: BackupDeclarationSchema.parse(JSON.parse(row.tables)) };
	}
}
