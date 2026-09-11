export const loadAppearanceCustomizerModal = () => import('./components/AppearanceCustomizerModal.vue');
export const loadAppearanceSettingsPanel = () => import('./components/AppearanceSettingsPanel.vue');
export { useAppearance } from './composables/useAppearance';
export type { AppearanceSettings, LocalHtmlTheme, RemoteHtmlTheme, TerminalTheme } from './model/appearance';
export { defaultTerminalTheme } from './config/default-theme';
