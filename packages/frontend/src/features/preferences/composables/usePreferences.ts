import { computed } from 'vue';
import type { PreferencesController } from '../model/preferences-types';
import { usePreferencesStore } from '../store/preferences.store';

export function usePreferences(): PreferencesController {
	const store = usePreferencesStore();
	return {
		values: computed(() => store.values),
		loaded: computed(() => store.loaded),
		version: computed(() => store.version),
		load: store.load.bind(store),
		update: store.update.bind(store),
		savePanelScale: store.savePanelScale.bind(store),
		saveWorkspacePreference: store.saveWorkspacePreference.bind(store),
		reset: store.reset.bind(store),
	};
}

export const resetPreferencesCache = (): void => usePreferencesStore().reset();
