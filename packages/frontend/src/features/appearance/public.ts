export const loadAppearanceCustomizerModal = () => import('./components/AppearanceCustomizerModal.vue');
export const loadAppearanceSettingsPanel = () => import('./components/AppearanceSettingsPanel.vue');
export { resetAppearanceCache, useAppearance } from './composables/useAppearance';
export type {
  AppearanceSettingsDto,
  AppearanceUpdateRequestDto,
  LocalHtmlThemeDto,
  RemoteHtmlThemeDto,
  TerminalThemeDto,
} from '@nexus-terminal/protocol/appearance';
export { defaultTerminalTheme } from './config/default-theme';
