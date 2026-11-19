import { z } from 'zod';
import { sql } from 'kysely';
import type { BackupDataApi } from '../../backup/node/backup-data-api.js';
import type { BackupDeclaration } from '../../backup/backup-types.js';
import { CodedError } from '../../utils/error.js';
import type { MigrationProvider } from 'kysely/migration';
import hostPackage from '../../../package.json' with { type: 'json' };
import type { BuiltinPlugin, PluginContextApi } from '../../plugin/plugin-api.node.js';
import { SettingsPatchSchema, SettingsSnapshotSchema, settingsPath } from '../settings-http-types.js';
import {
	SettingsPluginId,
	SettingsPreferencesSchema,
	SettingsTopic,
	defaultSettings,
	type SettingsSnapshot,
} from '../settings-types.js';

const table = 'preferences';

const backup = [
	{ table, version: 1, keys: ['id'], fields: { id: 'plain', value: 'plain' } },
] satisfies BackupDeclaration;

type Tables = { [table]: { id: string; revision: number; value: string } };

const migrations: MigrationProvider = {
	async getMigrations() {
		return {
			'001_preferences': {
				async up(db) {
					await db.schema
						.createTable(table)
						.addColumn('id', 'text', (column) => column.primaryKey())
						.addColumn('revision', 'integer', (column) => column.notNull())
						.addColumn('value', 'text', (column) => column.notNull())
						.execute();
				},
			},
		};
	},
};

function snapshot(row: Tables['preferences'] | undefined): SettingsSnapshot {
	return row
		? SettingsSnapshotSchema.parse({ revision: row.revision, preferences: JSON.parse(row.value) })
		: { revision: 0, preferences: defaultSettings };
}

export class SettingsPlugin implements BuiltinPlugin {
	readonly id = SettingsPluginId;
	readonly version = hostPackage.version;
	readonly migrations = migrations;
	readonly backup = backup;
	readonly #backupData: Pick<BackupDataApi, 'registerHostTable'>;

	constructor(backupData: Pick<BackupDataApi, 'registerHostTable'>) {
		this.#backupData = backupData;
	}

	async activate(context: PluginContextApi): Promise<void> {
		const { database, http, state } = context.app;
		await database.withClient((client) =>
			client
				.$extendTables<Tables>()
				.insertInto(table)
				.values({ id: 'owner', revision: 0, value: JSON.stringify(defaultSettings) })
				.onConflict((conflict) => conflict.column('id').doNothing())
				.execute(),
		);

		const read = () =>
			database.withClient(async (client) =>
				snapshot(
					await client
						.$extendTables<Tables>()
						.selectFrom(table)
						.selectAll()
						.where('id', '=', 'owner')
						.executeTakeFirst(),
				),
			);

		let current = await read();
		context.signal.throwIfAborted();
		const publisher = state.register({
			name: SettingsTopic.name,
			schema: SettingsSnapshotSchema,
			initial: current,
		});

		function publish(saved: SettingsSnapshot): void {
			if (saved.revision <= current.revision || context.signal.aborted) return;
			current = saved;
			publisher.publish(saved);
		}

		this.#backupData.registerHostTable(
			this.id,
			table,
			{
				validate(rows) {
					const row = rows[0];
					if (rows.length !== 1 || row?.id !== 'owner' || typeof row.value !== 'string')
						throw new CodedError('BACKUP_SETTINGS_INVALID');
					SettingsPreferencesSchema.parse(JSON.parse(row.value));
				},

				async written(db, name) {
					await sql`update ${sql.id(name)} set revision = revision + 1 where id = 'owner'`.execute(db);
				},

				async committed() {
					if (context.signal.aborted) return;
					publish(await read());
				},
			},
			context,
		);
		http.register([
			{
				method: 'get',
				path: settingsPath,
				input: z.strictObject({}),
				output: SettingsSnapshotSchema,

				handler: () => current,
			},
			{
				method: 'patch',
				path: settingsPath,
				input: SettingsPatchSchema,
				output: SettingsSnapshotSchema,

				handler: async (input: z.infer<typeof SettingsPatchSchema>, signal) => {
					signal.throwIfAborted();
					const saved = await database.withClient((client) =>
						client
							.$extendTables<Tables>()
							.transaction()
							.execute(async (db) => {
								const stored = snapshot(
									await db.selectFrom(table).selectAll().where('id', '=', 'owner').executeTakeFirst(),
								);
								if (!Object.keys(input).length) return stored;
								const next = {
									revision: stored.revision + 1,
									preferences: { ...stored.preferences, ...input },
								};
								const value = JSON.stringify(next.preferences);
								signal.throwIfAborted();
								await db
									.insertInto(table)
									.values({ id: 'owner', revision: next.revision, value })
									.onConflict((conflict) =>
										conflict.column('id').doUpdateSet({ revision: next.revision, value }),
									)
									.execute();
								return next;
							}),
					);
					// 已提交的更新即使浏览器断开也继续发布，较早的响应不覆盖新修订。
					publish(saved);
					return saved;
				},
			},
		] as const);
		context.self.readiness.set({ state: 'ready' });
	}
}
