import { defineStore } from 'pinia';
import { setFrontendLogLevel } from '@/client/logging/logger';
import { preferencesApi } from '../api/preferencesApi';
import {
  defaultPreferences,
  type PreferenceKey,
  type PreferencesPatchDto,
  type PreferencesDto,
} from '../model/preferences';

let preferenceUpdateRevision = 0;
const preferenceKeyRevisions = new Map<PreferenceKey, number>();
let preferenceLoadPromise: Promise<PreferencesDto> | null = null;
let preferenceCacheGeneration = 0;

export const usePreferencesStore = defineStore('preferences', {
  state: () => ({ values: { ...defaultPreferences } as PreferencesDto, loaded: false }),
  actions: {
    reset() {
      preferenceCacheGeneration += 1;
      preferenceUpdateRevision += 1;
      preferenceKeyRevisions.clear();
      preferenceLoadPromise = null;
      this.values = { ...defaultPreferences };
      this.loaded = false;
      setFrontendLogLevel(defaultPreferences.frontendLogLevel);
    },
    async load(force = false) {
      if (this.loaded && !force) return this.values;
      if (!force && preferenceLoadPromise) return preferenceLoadPromise;
      const generation = preferenceCacheGeneration;
      const load = preferencesApi.load().then((values) => {
        if (generation !== preferenceCacheGeneration) return this.values;
        this.values = values;
        setFrontendLogLevel(values.frontendLogLevel);
        this.loaded = true;
        return this.values;
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
        (previous as Record<string, unknown>)[key] = this.values[key];
        preferenceKeyRevisions.set(key, revision);
      }

      Object.assign(this.values, patch);
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
        Object.assign(this.values, rollback);
        if (rollback.frontendLogLevel !== undefined) setFrontendLogLevel(rollback.frontendLogLevel, true);
        throw cause;
      }
    },
  },
});
