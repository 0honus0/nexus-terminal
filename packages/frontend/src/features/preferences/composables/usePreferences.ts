import { computed } from 'vue';
import { usePreferencesStore } from '../store/preferences.store';
export function usePreferences() {
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
