import { z } from 'zod';
import type { BackupDataApi } from '../../backup/node/backup-data-api.js';
import hostPackage from '../../../package.json' with { type: 'json' };
import type { BuiltinPlugin, PluginContextApi } from '../../plugin/plugin-api.node.js';
import { SettingsPatchSchema, SettingsSnapshotSchema, settingsPath } from '../settings-http-types.js';
import { SettingsPluginId, SettingsTopic, type SettingsSnapshot } from '../settings-types.js';
import { SettingsStorage, backup, migrations, settingsTable } from './settings-storage.js';

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
		const storage = new SettingsStorage(database);
		await storage.initialize();

		let current = await storage.read();
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
			settingsTable,
			{
				validate: (rows) => storage.validateBackupRows(rows),

				written: (db, name) => storage.incrementBackupRevision(db, name),

				async committed() {
					if (context.signal.aborted) return;
					publish(await storage.read());
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
					const saved = await storage.update(input, signal);
					// 已提交的更新即使浏览器断开也继续发布，较早的响应不覆盖新修订。
					publish(saved);
					return saved;
				},
			},
		] as const);
		context.self.readiness.set({ state: 'ready' });
	}
}
