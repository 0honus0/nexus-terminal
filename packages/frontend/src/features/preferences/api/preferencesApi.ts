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
    const [settings, nav, connectionTags, quickCommandTags] = await Promise.all([
      httpClient.get<Partial<Preferences>>('/settings'),
      httpClient.get<{ visible: boolean }>('/settings/nav-bar-visibility'),
      httpClient.get<{ enabled: boolean }>('/settings/show-connection-tags'),
      httpClient.get<{ enabled: boolean }>('/settings/show-quick-command-tags'),
    ]);
    return {
      ...mergePreferences(settings.data),
      navBarVisible: nav.data.visible,
      showConnectionTags: connectionTags.data.enabled,
      showQuickCommandTags: quickCommandTags.data.enabled,
    };
  },
  async update(patch: PreferencePatch): Promise<void> {
    const { navBarVisible, showConnectionTags, showQuickCommandTags, ...settingsPatch } = patch;
    const updates: Promise<unknown>[] = [];
    if (Object.keys(settingsPatch).length) updates.push(httpClient.put('/settings', settingsPatch));
    if (navBarVisible !== undefined)
      updates.push(httpClient.put('/settings/nav-bar-visibility', { visible: navBarVisible }));
    if (showConnectionTags !== undefined)
      updates.push(httpClient.put('/settings/show-connection-tags', { enabled: showConnectionTags }));
    if (showQuickCommandTags !== undefined)
      updates.push(httpClient.put('/settings/show-quick-command-tags', { enabled: showQuickCommandTags }));
    await Promise.all(updates);
  },
};
