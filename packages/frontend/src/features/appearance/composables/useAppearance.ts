import { computed, type ComputedRef } from 'vue';
import type { AppearanceUpdateRequestDto, TerminalThemeDto } from '@nexus-terminal/protocol/appearance';
import { useAppearanceStore } from '../store/appearance.store';

export interface AppearanceController {
  settings: ComputedRef<Readonly<AppearanceUpdateRequestDto>>;
  themes: ComputedRef<readonly TerminalThemeDto[]>;
  customizerVisible: ComputedRef<boolean>;
  load(force?: boolean): Promise<void>;
  update(patch: AppearanceUpdateRequestDto): Promise<void>;
  previewSettings(patch: AppearanceUpdateRequestDto): void;
  openCustomizer(): void;
  closeCustomizer(): void;
  reset(): void;
}

/** Public Appearance capability facade. The internal Pinia store stays feature-private. */
export function useAppearance(): AppearanceController {
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
