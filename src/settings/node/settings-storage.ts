import { sql, type Kysely, type QueryExecutorProvider } from 'kysely';
import type { MigrationProvider } from 'kysely/migration';
import type { BackupDeclaration } from '../../backup/backup-types.js';
import type { PluginDatabaseApi } from '../../database/node/database-plugin-api.js';
import { CodedError } from '../../utils/error.js';
import {
	SettingsPreferencesSchema,
	SettingsSnapshotSchema,
	defaultSettings,
	type SettingsPreferences,
	type SettingsSnapshot,
} from '../settings-types.js';

export const settingsTable = 'preferences';

const owner = 'owner';

export const backup = [
	{ table: settingsTable, version: 1, keys: ['id'], fields: { id: 'plain', value: 'plain' } },
] satisfies BackupDeclaration;

type Tables = { [settingsTable]: { id: string; revision: number; value: string } };

export const migrations: MigrationProvider = {
	async getMigrations() {
		return {
			'001_preferences': {
				async up(db) {
					await db.schema
						.createTable(settingsTable)
						.addColumn('id', 'text', (column) => column.primaryKey())
						.addColumn('revision', 'integer', (column) => column.notNull())
						.addColumn('value', 'text', (column) => column.notNull())
						.execute();
				},
			},
		};
	},
};

export class SettingsStorage {
	readonly #database: PluginDatabaseApi;

	constructor(database: PluginDatabaseApi) {
		this.#database = database;
	}

	async initialize(): Promise<void> {
		await this.#database.withClient((client) =>
			client
				.$extendTables<Tables>()
				.insertInto(settingsTable)
				.values({ id: owner, revision: 0, value: JSON.stringify(defaultSettings) })
				.onConflict((conflict) => conflict.column('id').doNothing())
				.execute(),
		);
	}

	read(): Promise<SettingsSnapshot> {
		return this.#database.withClient((client) => this.#read(client.$extendTables<Tables>()));
	}

	update(input: Partial<SettingsPreferences>, signal: AbortSignal, onlyInitial = false): Promise<SettingsSnapshot> {
		signal.throwIfAborted();
		return this.#database.withClient((client) =>
			client
				.$extendTables<Tables>()
				.transaction()
				.execute(async (db) => {
					const stored = await this.#read(db);
					if ((onlyInitial && stored.revision !== 0) || !Object.keys(input).length) return stored;

					const revision = stored.revision + 1;
					const preferences = { ...stored.preferences, ...input };
					const value = JSON.stringify(preferences);
					signal.throwIfAborted();
					await db
						.insertInto(settingsTable)
						.values({ id: owner, revision, value })
						.onConflict((conflict) => conflict.column('id').doUpdateSet({ revision, value }))
						.execute();
					return { revision, preferences };
				}),
		);
	}

	validateBackupRows(rows: readonly Record<string, unknown>[]): void {
		const row = rows[0];
		if (rows.length !== 1 || row?.id !== owner || typeof row.value !== 'string')
			throw new CodedError('BACKUP_SETTINGS_INVALID');
		SettingsPreferencesSchema.parse(JSON.parse(row.value));
	}

	/** 使用恢复事务提供的连接，确保修订号随设置数据一起提交。 */
	async incrementBackupRevision(db: QueryExecutorProvider, name: string): Promise<void> {
		await sql`update ${sql.id(name)} set revision = revision + 1 where id = ${owner}`.execute(db);
	}

	async #read(db: Kysely<Tables>): Promise<SettingsSnapshot> {
		const row = await db
			.selectFrom(settingsTable)
			.select(['revision', 'value'])
			.where('id', '=', owner)
			.executeTakeFirst();
		if (!row) return { revision: 0, preferences: defaultSettings };
		return SettingsSnapshotSchema.parse({ revision: row.revision, preferences: JSON.parse(row.value) });
	}
}
