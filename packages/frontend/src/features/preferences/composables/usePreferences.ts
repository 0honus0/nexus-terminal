import { computed, type ComputedRef } from 'vue';
import type { PreferencesDto, PreferencesPatchDto } from '../model/preferences';
import { usePreferencesStore } from '../store/preferences.store';

export interface PreferencesController {
  values: ComputedRef<PreferencesDto>;
  loaded: ComputedRef<boolean>;
  load(force?: boolean): Promise<PreferencesDto>;
  update(patch: PreferencesPatchDto): Promise<void>;
  reset(): void;
}

export function usePreferences(): PreferencesController {
  const store = usePreferencesStore();
  return {
    values: computed(() => store.values),
    loaded: computed(() => store.loaded),
    load: store.load.bind(store),
    update: store.update.bind(store),
    reset: store.reset.bind(store),
  };
}

export const resetPreferencesCache = (): void => usePreferencesStore().reset();
