import { computed } from 'vue';
import type { AppearanceSettings, TerminalTheme } from '../model/appearance';
import { useAppearanceStore } from '../store/appearance.store';

/** Public Appearance capability facade. The internal Pinia store stays feature-private. */
export function useAppearance() {
  const store = useAppearanceStore();

  return {
    settings: computed<Readonly<AppearanceSettings>>(() => store.settings),
    themes: computed<readonly TerminalTheme[]>(() => store.themes),
    customizerVisible: computed(() => store.customizerVisible),
    load: store.load.bind(store),
    update: store.update.bind(store),
    previewSettings: store.previewSettings.bind(store),
    openCustomizer: store.openCustomizer.bind(store),
    closeCustomizer: store.closeCustomizer.bind(store),
  };
}
