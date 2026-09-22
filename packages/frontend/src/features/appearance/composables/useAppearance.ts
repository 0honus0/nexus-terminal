import { computed } from 'vue';
import type { AppearanceUpdateRequestDto, TerminalThemeDto } from '@nexus-terminal/protocol/appearance';
import { useAppearanceStore } from '../store/appearance.store';

/** Public Appearance capability facade. The internal Pinia store stays feature-private. */
export function useAppearance() {
  const store = useAppearanceStore();

  return {
    settings: computed<Readonly<AppearanceUpdateRequestDto>>(() => store.settings),
    themes: computed<readonly TerminalThemeDto[]>(() => store.themes),
    customizerVisible: computed(() => store.customizerVisible),
    load: store.load.bind(store),
    update: store.update.bind(store),
    previewSettings: store.previewSettings.bind(store),
    openCustomizer: store.openCustomizer.bind(store),
    closeCustomizer: store.closeCustomizer.bind(store),
    reset: store.reset.bind(store),
  };
}

export const resetAppearanceCache = (): void => useAppearanceStore().reset();
