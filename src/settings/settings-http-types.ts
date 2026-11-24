import { SettingsPluginId, SettingsPreferencesSchema } from './settings-types.js';

export { SettingsPatchSchema, SettingsSnapshotSchema } from './settings-types.js';

export const SettingsInitialLocaleSchema = SettingsPreferencesSchema.pick({ locale: true });

export const settingsPath = '/preferences';

export const settingsBase = `/api/plugins/${encodeURIComponent(SettingsPluginId)}${settingsPath}`;
