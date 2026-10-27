import type { SnapshotRegistration, SnapshotTable } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import type { SecretBox } from '../../../../../platform/security/secret-box.js';
import {
	transferSnapshotRow,
	restoreSnapshotRow,
	snapshotFile,
} from '../../../../../platform/storage/sqlite/adapters/snapshot-row.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { appearanceRow } from '../../../appearance/adapters/sqlite/appearance-row.js';
import { backgroundRow } from '../../../appearance/adapters/sqlite/background-row.js';
import { configurationRow } from '../../../configuration/adapters/sqlite/configuration-row.js';
import { commandRow, commandTagRow } from '../../../commands/adapters/sqlite/command-row.js';
import { favoriteRow } from '../../../favorites/adapters/sqlite/favorite-row.js';
import { historyRow } from '../../../history/adapters/sqlite/history-row.js';
import { themeRow } from '../../../themes/adapters/sqlite/theme-row.js';
import { presentationRow } from '../../../presentation/adapters/sqlite/presentation-row.js';
import { htmlThemeRow } from '../../../appearance/adapters/sqlite/html-theme-row.js';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredConfiguration } from '../../../configuration/storage/configuration-storage.js';
import type { StoredAppearance } from '../../../appearance/storage/appearance-storage.js';

function secretColumns(table: string): ReadonlyMap<string, string> {
	return table === 'preferences_configuration'
		? new Map([['captcha_secret_encrypted', 'preferences:captcha']])
		: new Map();
}

/** Fixed current table/column coverage owned by preferences; no runtime schema discovery. */
export function registerPreferencesSnapshot(
	secrets: SecretBox | null,
	admitAppearance: (value: StoredAppearance) => void,
	admitConfiguration: (value: StoredConfiguration) => void,
): SnapshotRegistration {
	const tables: SnapshotTable[] = [
		{
			name: 'preferences_appearance',
			columns: ['user_id', 'version', 'active_theme_id', 'settings_json', 'updated_at'],
		},
		{
			name: 'preferences_backgrounds',
			columns: ['id', 'user_id', 'kind', 'media_type', 'size_bytes', 'sha256', 'status'],
		},
		{ name: 'preferences_html_revisions', columns: ['user_id', 'version'] },
		{ name: 'preferences_html_themes', columns: ['user_id', 'name', 'content', 'version', 'updated_at'] },
		{
			name: 'preferences_commands',
			columns: [
				'id',
				'user_id',
				'version',
				'name',
				'command',
				'variables_json',
				'usage_count',
				'created_at',
				'updated_at',
			],
		},
		{ name: 'preferences_command_tags', columns: ['id', 'user_id', 'version', 'name', 'created_at', 'updated_at'] },
		{ name: 'preferences_command_associations', columns: ['user_id', 'command_id', 'tag_id'] },
		{
			name: 'preferences_configuration',
			columns: [
				'id',
				'version',
				'ip_whitelist',
				'blacklist_enabled',
				'max_login_attempts',
				'login_ban_seconds',
				'status_interval_seconds',
				'resource_refresh_seconds',
				'passkeys_json',
				'captcha_enabled',
				'captcha_provider',
				'captcha_site_key',
				'captcha_secret_encrypted',
				'captcha_expected_hostname',
			],
		},
		{
			name: 'preferences_favorites',
			columns: ['id', 'user_id', 'version', 'name', 'path', 'last_used_at', 'created_at', 'updated_at'],
		},
		{ name: 'preferences_history', columns: ['id', 'user_id', 'kind', 'text', 'recorded_at'] },
		{ name: 'preferences_presentation', columns: ['user_id', 'version', 'value_json'] },
		{
			name: 'preferences_themes',
			columns: ['id', 'user_id', 'version', 'name', 'colors_json', 'preset_key', 'created_at', 'updated_at'],
		},
	];
	for (const table of tables) {
		if (table.columns.includes('user_id')) {
			table.partitionColumn = 'user_id';
			table.allowNullPartition = table.name === 'preferences_themes';
		}
	}
	return {
		tables,

		validate(rows) {
			const configurations = rows.get('preferences_configuration') ?? [];
			if (configurations.length !== 1 || configurations[0].id !== 1) {
				throw new SnapshotFailure('unavailable');
			}
			admitConfiguration(configurationRow(configurations[0]));
			for (const row of rows.get('preferences_favorites') ?? []) {
				favoriteRow(row);
			}
			for (const row of rows.get('preferences_history') ?? []) {
				historyRow(row);
			}
			const themes = rows.get('preferences_themes') ?? [];
			const themeOwners = new Map(themes.map((row) => [row.id, row.user_id]));
			for (const row of themes) {
				themeRow(row);
			}
			for (const row of rows.get('preferences_presentation') ?? []) {
				presentationRow(row);
			}
			const htmlRevisions = new Map<unknown, number>();
			for (const row of rows.get('preferences_html_revisions') ?? []) {
				if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1) {
					throw new SnapshotFailure('unavailable');
				}
				htmlRevisions.set(row.user_id, row.version);
			}
			for (const row of rows.get('preferences_html_themes') ?? []) {
				const theme = htmlThemeRow(row);
				const revision = htmlRevisions.get(row.user_id);
				if (revision === undefined || revision < theme.version) {
					throw new SnapshotFailure('unavailable');
				}
			}
			const tags = rows.get('preferences_command_tags') ?? [];
			for (const row of tags) {
				commandTagRow(row);
			}
			const commands = rows.get('preferences_commands') ?? [];
			const commandOwners = new Map(commands.map((row) => [row.id, row.user_id]));
			const tagOwners = new Map(tags.map((row) => [row.id, row.user_id]));
			const associations = new Map<unknown, SqlRow[]>();
			for (const row of rows.get('preferences_command_associations') ?? []) {
				if (commandOwners.get(row.command_id) !== row.user_id || tagOwners.get(row.tag_id) !== row.user_id) {
					throw new SnapshotFailure('unavailable');
				}
				const linked = associations.get(row.command_id) ?? [];
				linked.push(row);
				associations.set(row.command_id, linked);
			}
			for (const row of commands) {
				commandRow(row, associations.get(row.id) ?? []);
			}
			const backgrounds = rows.get('preferences_backgrounds') ?? [];
			const backgroundsById = new Map(backgrounds.map((row) => [row.id, row]));
			for (const row of backgrounds) {
				backgroundRow(row);
				if (row.status === 'pending') {
					throw new SnapshotFailure('source_changed');
				}
			}
			for (const row of rows.get('preferences_appearance') ?? []) {
				const value = appearanceRow(row);
				admitAppearance(value);
				if (value.activeThemeId !== null) {
					const owner = themeOwners.get(value.activeThemeId);
					if (owner !== null && owner !== row.user_id) {
						throw new SnapshotFailure('unavailable');
					}
				}
				for (const [id, kind] of [
					[value.settings.pageBackgroundId, 'page'],
					[value.settings.terminalBackgroundId, 'terminal'],
				]) {
					if (id === null) {
						continue;
					}
					const background = backgroundsById.get(id);
					if (
						!background ||
						background.user_id !== row.user_id ||
						background.kind !== kind ||
						background.status !== 'ready'
					) {
						throw new SnapshotFailure('unavailable');
					}
				}
			}
		},

		transfer(table, row) {
			return transferSnapshotRow(row, table.columns, secretColumns(table.name), secrets);
		},

		restore(table, row) {
			return restoreSnapshotRow(row, table.columns, secretColumns(table.name), secrets);
		},

		files(table, row) {
			if (table === 'preferences_backgrounds' && row.status === 'ready') {
				return [snapshotFile('appearance', row, 'sha256')];
			}
			return [];
		},
	};
}
