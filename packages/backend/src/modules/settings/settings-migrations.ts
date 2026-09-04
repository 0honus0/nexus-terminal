import type { SettingsMigrationRepository, SettingsMigrationPatch } from './settings-migration.repository.port';
import type { SettingsRepository } from './settings.repository.port';

export interface SettingsMigration {
  readonly version: number;
  readonly name: string;
  up(values: Readonly<Record<string, string>>): SettingsMigrationPatch;
}

const renameSetting = (version: number, from: string, to: string): SettingsMigration => ({
  version,
  name: `Rename ${from} to ${to}`,
  up(values) {
    const legacyValue = values[from];
    return {
      ...(legacyValue !== undefined && values[to] === undefined ? { set: { [to]: legacyValue } } : {}),
      remove: [from],
    };
  },
});

const removeSetting = (version: number, key: string): SettingsMigration => ({
  version,
  name: `Remove ${key}`,
  up: () => ({ remove: [key] }),
});

export const SETTINGS_MIGRATIONS: readonly SettingsMigration[] = [
  renameSetting(1, 'terminalEnableRightClickPaste', 'terminalRightClickCopyPaste'),
  removeSetting(2, 'autoCopyOnSelect'),
  removeSetting(3, 'clearFileEditorTabsOnClose'),
  renameSetting(4, 'remoteHtmlPresetsUrl', 'remote_html_presets_url'),
  {
    version: 5,
    name: 'Move legacy HTML preset repository to the canonical project URL',
    up(values) {
      const current = values.remote_html_presets_url?.trim().replace(/\/+$/, '');
      return current === 'https://github.com/Heavrnl/nexus-terminal/tree/main/doc/custom_html_theme'
        ? {
            set: {
              remote_html_presets_url: 'https://github.com/0honus0/nexus-terminal/tree/main/doc/custom_html_theme',
            },
          }
        : {};
    },
  },
];

const validateMigrations = (migrations: readonly SettingsMigration[]): void => {
  let previous = 0;
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0)
      throw new Error(`Invalid settings migration version: ${migration.version}`);
    if (seen.has(migration.version)) throw new Error(`Duplicate settings migration version: ${migration.version}`);
    if (migration.version <= previous)
      throw new Error(`Settings migrations must be declared in ascending version order: ${migration.version}`);
    seen.add(migration.version);
    previous = migration.version;
  }
};

const applyPatchToSnapshot = (values: Record<string, string>, patch: SettingsMigrationPatch): void => {
  if (patch.set) Object.assign(values, patch.set);
  for (const key of patch.remove ?? []) delete values[key];
};

/**
 * Runs versioned settings migrations in ascending order.
 *
 * Each migration is persisted atomically by SettingsMigrationRepository: the
 * settings changes and the settings_migrations history row commit together.
 * New installations record no-op migrations too, so every database has an
 * explicit configuration-schema version just like the SQL schema history.
 */
export async function runSettingsMigrations(
  settings: SettingsRepository,
  history: SettingsMigrationRepository,
  migrations: readonly SettingsMigration[] = SETTINGS_MIGRATIONS,
): Promise<Record<string, string>> {
  validateMigrations(migrations);
  const values = Object.fromEntries((await settings.list()).map((item) => [item.key, item.value]));
  const currentVersion = await history.getCurrentVersion();
  const targetVersion = migrations.at(-1)?.version ?? 0;

  if (currentVersion > targetVersion)
    throw new Error(
      `Settings schema version ${currentVersion} is newer than this application supports (${targetVersion}).`,
    );

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    const patch = migration.up(values);
    await history.apply(migration.version, migration.name, patch);
    applyPatchToSnapshot(values, patch);
  }

  return values;
}
