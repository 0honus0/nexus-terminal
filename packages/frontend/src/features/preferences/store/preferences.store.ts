import { defineStore } from 'pinia';
import { ref } from 'vue';
import { setFrontendLogLevel } from '@/client/logging/logger';
import { preferencesApi } from '../api/preferencesApi';
import {
  defaultPreferences,
  type PreferenceKey,
  type PreferencesPatchDto,
  type PreferencesDto,
} from '../model/preferences';

export const usePreferencesStore = defineStore('preferences', () => {
  const values = ref<PreferencesDto>({ ...defaultPreferences });
  const loaded = ref(false);
  let preferenceUpdateRevision = 0;
  const preferenceKeyRevisions = new Map<PreferenceKey, number>();
  let preferenceLoadPromise: Promise<PreferencesDto> | null = null;
  let preferenceCacheGeneration = 0;

  return {
    values,
    loaded,
    reset() {
      preferenceCacheGeneration += 1;
      preferenceUpdateRevision += 1;
      preferenceKeyRevisions.clear();
      preferenceLoadPromise = null;
      values.value = { ...defaultPreferences };
      loaded.value = false;
      setFrontendLogLevel(defaultPreferences.frontendLogLevel);
    },
    async load(force = false) {
      if (loaded.value && !force) return values.value;
      if (!force && preferenceLoadPromise) return preferenceLoadPromise;
      const generation = preferenceCacheGeneration;
      const load = preferencesApi.load().then((incoming) => {
        if (generation !== preferenceCacheGeneration) return values.value;
        values.value = incoming;
        setFrontendLogLevel(incoming.frontendLogLevel);
        loaded.value = true;
        return values.value;
      });
      if (!force) preferenceLoadPromise = load;
      try {
        return await load;
      } finally {
        if (preferenceLoadPromise === load) preferenceLoadPromise = null;
      }
    },
    async update(patch: PreferencesPatchDto) {
      const revision = ++preferenceUpdateRevision;
      const keys = Object.keys(patch) as PreferenceKey[];
      const previous: Partial<PreferencesDto> = {};
      for (const key of keys) {
        (previous as Record<string, unknown>)[key] = values.value[key];
        preferenceKeyRevisions.set(key, revision);
      }

      Object.assign(values.value, patch);
      if (patch.frontendLogLevel !== undefined) setFrontendLogLevel(patch.frontendLogLevel, true);
      try {
        await preferencesApi.update(patch);
        for (const key of keys) {
          if (preferenceKeyRevisions.get(key) === revision) preferenceKeyRevisions.delete(key);
        }
      } catch (cause) {
        const rollback: Partial<PreferencesDto> = {};
        for (const key of keys) {
          if (preferenceKeyRevisions.get(key) !== revision) continue;
          (rollback as Record<string, unknown>)[key] = previous[key];
          preferenceKeyRevisions.delete(key);
        }
        Object.assign(values.value, rollback);
        if (rollback.frontendLogLevel !== undefined) setFrontendLogLevel(rollback.frontendLogLevel, true);
        throw cause;
      }
    },
  };
});
