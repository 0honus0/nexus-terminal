import { defineStore } from 'pinia';
import { preferencesApi } from '../api/preferencesApi';
import { defaultPreferences, type PreferencePatch, type Preferences } from '../model/preferences';

export const usePreferencesStore = defineStore('preferences', {
  state: () => ({ values: { ...defaultPreferences } as Preferences, loaded: false }),
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return this.values;
      this.values = await preferencesApi.load();
      this.loaded = true;
      return this.values;
    },
    async update(patch: PreferencePatch) {
      await preferencesApi.update(patch);
      Object.assign(this.values, patch);
    },
  },
});
