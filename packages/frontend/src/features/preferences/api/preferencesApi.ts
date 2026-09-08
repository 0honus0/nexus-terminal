import { httpClient } from '@/client/http';
import { defaultPreferences, type PreferenceKey, type PreferencePatch, type Preferences } from '../model/preferences';

const mergePreferences = (raw: Partial<Preferences>): Preferences => {
  const result = { ...defaultPreferences };
  for (const key of Object.keys(defaultPreferences) as PreferenceKey[]) {
    const value = raw[key];
    if (value !== undefined) (result as Record<string, unknown>)[key] = value;
  }
  return result;
};

export const preferencesApi = {
  async load(): Promise<Preferences> {
    const settings = await httpClient.get<Partial<Preferences>>('/settings');
    return mergePreferences(settings.data);
  },
  async update(patch: PreferencePatch): Promise<void> {
    if (Object.keys(patch).length) await httpClient.put('/settings', patch);
  },
};
