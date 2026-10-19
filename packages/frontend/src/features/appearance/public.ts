export const loadAppearanceCustomizerModal = () => import('./components/AppearanceCustomizerModal.vue');

export const loadAppearanceSettingsPanel = () => import('./components/AppearanceSettingsPanel.vue');

export { resetAppearanceCache, useAppearance } from './composables/useAppearance';

export type { AppearanceController } from './composables/useAppearance';

export { defaultTerminalTheme } from './config/default-theme';
