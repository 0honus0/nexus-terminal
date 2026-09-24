import type { AppStorageSnapshot, AppStorageSnapshotEntry } from './app-storage-snapshot.port';

export const AGENT_EXECUTION_POLICY_STORAGE_KEY = 'agent.execution-policy.v1';
export const SUBAGENT_PROFILES_STORAGE_KEY = 'subagent.profiles.v1';

const HOST_OWNED_APP_STORAGE_KEYS = new Set<string>([
  AGENT_EXECUTION_POLICY_STORAGE_KEY,
  SUBAGENT_PROFILES_STORAGE_KEY,
]);

export const isHostOwnedAppStorageKey = (key: string): boolean => HOST_OWNED_APP_STORAGE_KEYS.has(key);

export const assertPluginOwnedAppStorageKey = (key: string): void => {
  if (isHostOwnedAppStorageKey(key)) throw new Error('APP_STORAGE_KEY_RESERVED');
};

const snapshotFrom = (entries: AppStorageSnapshotEntry[]): AppStorageSnapshot => ({
  entries,
  totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
});

export const pluginOwnedAppStorageSnapshot = (snapshot: AppStorageSnapshot): AppStorageSnapshot =>
  snapshotFrom(snapshot.entries.filter((entry) => !isHostOwnedAppStorageKey(entry.key)));

export const hostOwnedAppStorageSnapshot = (snapshot: AppStorageSnapshot): AppStorageSnapshot =>
  snapshotFrom(snapshot.entries.filter((entry) => isHostOwnedAppStorageKey(entry.key)));

export const mergePluginOwnedAppStorageSnapshot = (
  current: AppStorageSnapshot,
  pluginSnapshot: AppStorageSnapshot,
): AppStorageSnapshot => {
  for (const entry of pluginSnapshot.entries) assertPluginOwnedAppStorageKey(entry.key);
  return snapshotFrom([
    ...current.entries.filter((entry) => isHostOwnedAppStorageKey(entry.key)),
    ...pluginSnapshot.entries,
  ]);
};
