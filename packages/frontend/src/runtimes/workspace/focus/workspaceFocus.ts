import { computed, ref } from 'vue';
import { httpClient } from '@/client/http';

export interface WorkspaceFocusConfig {
  sequence: string[];
  shortcuts: Record<string, { shortcut?: string }>;
}

export const workspaceFocusTargets = [
  'quickCommandsSearch',
  'commandHistorySearch',
  'fileManagerSearch',
  'commandInput',
  'terminalSearch',
  'connectionListSearch',
  'fileEditorActive',
  'fileManagerPathInput',
] as const;

type WorkspaceFocusTarget = (typeof workspaceFocusTargets)[number];
const isFocusTarget = (value: string): value is WorkspaceFocusTarget =>
  workspaceFocusTargets.includes(value as WorkspaceFocusTarget);

export const normalizeWorkspaceFocusShortcut = (value: string): string | null => {
  const match = value.trim().match(/^Alt\+([A-Za-z0-9])$/);
  return match ? `Alt+${match[1]!.toUpperCase()}` : null;
};

const defaultConfig = (): WorkspaceFocusConfig => ({ sequence: [...workspaceFocusTargets], shortcuts: {} });
const config = ref<WorkspaceFocusConfig>(defaultConfig());
const loaded = ref(false);

const configShape = (value: unknown): value is WorkspaceFocusConfig => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<WorkspaceFocusConfig>;
  return (
    Array.isArray(candidate.sequence) &&
    candidate.sequence.every((id) => typeof id === 'string' && isFocusTarget(id)) &&
    new Set(candidate.sequence).size === candidate.sequence.length &&
    Boolean(candidate.shortcuts && typeof candidate.shortcuts === 'object' && !Array.isArray(candidate.shortcuts))
  );
};

const normalizeLoadedConfig = (value: unknown): WorkspaceFocusConfig | null => {
  if (!configShape(value)) return null;
  const shortcuts: WorkspaceFocusConfig['shortcuts'] = {};
  for (const [id, item] of Object.entries(value.shortcuts)) {
    if (!isFocusTarget(id) || !item || typeof item !== 'object' || Array.isArray(item)) continue;
    const shortcut = (item as { shortcut?: unknown }).shortcut;
    if (shortcut === undefined) continue;
    if (typeof shortcut !== 'string') continue;
    const normalized = normalizeWorkspaceFocusShortcut(shortcut);
    if (normalized) shortcuts[id] = { shortcut: normalized };
  }
  return { sequence: [...value.sequence], shortcuts };
};

const validConfigForSave = (value: WorkspaceFocusConfig): boolean => {
  if (!configShape(value)) return false;
  return Object.entries(value.shortcuts).every(([id, item]) => {
    if (!isFocusTarget(id) || !item || typeof item !== 'object' || Array.isArray(item)) return false;
    return item.shortcut === undefined || normalizeWorkspaceFocusShortcut(item.shortcut) === item.shortcut;
  });
};

export const workspaceFocus = {
  config,
  loaded: computed(() => loaded.value),
  async load(force = false): Promise<void> {
    if (loaded.value && !force) return;
    const { data } = await httpClient.get<unknown>('/settings/focus-switcher-sequence');
    config.value = normalizeLoadedConfig(data) ?? defaultConfig();
    loaded.value = true;
  },
  async save(next: WorkspaceFocusConfig): Promise<void> {
    if (!validConfigForSave(next)) throw new Error('Invalid focus switcher configuration.');
    await httpClient.put('/settings/focus-switcher-sequence', next);
    config.value = structuredClone(next);
    loaded.value = true;
  },
};
