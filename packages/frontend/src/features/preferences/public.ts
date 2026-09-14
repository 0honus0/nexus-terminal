export const loadPreferencesSettingsPanel = () => import('./components/PreferencesSettingsPanel.vue');
export const loadWorkspacePreferencesPanel = () => import('./components/WorkspacePreferencesPanel.vue');
export { usePreferences } from './composables/usePreferences';
export type { Preferences, PreferenceKey, PreferencePatch } from './model/preferences';
export { commonTimezones, preferenceLanguageNames, terminalScrollbackForRuntime } from './model/preferences';
