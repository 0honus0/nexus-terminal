import { SettingsPluginId } from './settings-types.js';

export { SettingsPatchSchema, SettingsSnapshotSchema } from './settings-types.js';

export const settingsPath = '/preferences';

export const settingsBase = `/api/plugins/${encodeURIComponent(SettingsPluginId)}${settingsPath}`;
