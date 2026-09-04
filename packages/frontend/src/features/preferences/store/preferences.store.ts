import { defineStore } from 'pinia';
import { preferencesApi } from '../api/preferencesApi';
import { defaultPreferences, type PreferenceKey, type PreferencePatch, type Preferences } from '../model/preferences';

let preferenceUpdateRevision = 0;
const preferenceKeyRevisions = new Map<PreferenceKey, number>();

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
      const revision = ++preferenceUpdateRevision;
      const keys = Object.keys(patch) as PreferenceKey[];
      const previous: Partial<Preferences> = {};
      for (const key of keys) {
        (previous as Record<string, unknown>)[key] = this.values[key];
        preferenceKeyRevisions.set(key, revision);
      }

      Object.assign(this.values, patch);
      try {
        await preferencesApi.update(patch);
        for (const key of keys) {
          if (preferenceKeyRevisions.get(key) === revision) preferenceKeyRevisions.delete(key);
        }
      } catch (cause) {
        const rollback: Partial<Preferences> = {};
        for (const key of keys) {
          if (preferenceKeyRevisions.get(key) !== revision) continue;
          (rollback as Record<string, unknown>)[key] = previous[key];
          preferenceKeyRevisions.delete(key);
        }
        Object.assign(this.values, rollback);
        throw cause;
      }
    },
  },
});
