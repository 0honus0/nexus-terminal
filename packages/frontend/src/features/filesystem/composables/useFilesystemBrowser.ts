import { computed, ref, watch } from 'vue';
import type { FilesystemChannel } from '../ports/filesystem-channel';
import type { FileSearchEntry, RemoteFileEntry } from '../model/filesystem';

export type FilesystemSortKey = 'name' | 'size' | 'permissions' | 'modified';
export type FilesystemSortDirection = 'asc' | 'desc';

const parentPath = (path: string) => {
  const normalized = path.replace(/\/+$/, '') || '/';
  if (normalized === '/') return '/';
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
};

const entryName = (entry: RemoteFileEntry): string =>
  'relativePath' in entry && typeof (entry as FileSearchEntry).relativePath === 'string'
    ? (entry as FileSearchEntry).relativePath
    : entry.name;

const compare = (left: RemoteFileEntry, right: RemoteFileEntry, key: FilesystemSortKey): number => {
  if (key === 'size') return left.metadata.size - right.metadata.size;
  if (key === 'permissions') return left.metadata.mode - right.metadata.mode;
  if (key === 'modified') return left.metadata.modifiedAt - right.metadata.modifiedAt;
  return entryName(left).localeCompare(entryName(right), undefined, { numeric: true, sensitivity: 'base' });
};

export function useFilesystemBrowser(channel: FilesystemChannel, initialPath = '/') {
  const path = ref(initialPath);
  const entries = ref<RemoteFileEntry[]>([]);
  const searchEntries = ref<FileSearchEntry[]>([]);
  const searchQuery = ref('');
  const searching = ref(false);
  const searchTruncated = ref(false);
  const searchError = ref<string | null>(null);
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);
  const selected = ref(new Set<string>());
  const selectionAnchor = ref<string | null>(null);
  const sortKey = ref<FilesystemSortKey>('name');
  const sortDirection = ref<FilesystemSortDirection>('asc');
  let searchTimer: number | undefined;
  let searchToken = 0;

  const searchActive = computed(() => Boolean(searchQuery.value.trim()));

  const visible = computed(() =>
    [...(searchActive.value ? searchEntries.value : entries.value)].sort((left, right) => {
      if (left.name === '..') return -1;
      if (right.name === '..') return 1;
      const result = compare(left, right, sortKey.value);
      return sortDirection.value === 'asc' ? result : -result;
    }),
  );

  const clearSearchTimer = () => {
    if (searchTimer === undefined) return;
    window.clearTimeout(searchTimer);
    searchTimer = undefined;
  };

  const resetSearchResults = () => {
    searchEntries.value = [];
    searchTruncated.value = false;
    searchError.value = null;
  };

  const runSearch = async (query: string, root: string, token: number) => {
    try {
      const result = await channel.search(root, query);
      if (token !== searchToken || searchQuery.value.trim() !== query || path.value !== root) return;
      searchEntries.value = result.entries;
      searchTruncated.value = result.truncated;
    } catch (cause) {
      if (token !== searchToken) return;
      searchError.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (token === searchToken) searching.value = false;
    }
  };

  const scheduleSearch = (delayMs = 250) => {
    clearSearchTimer();
    const query = searchQuery.value.trim();
    if (!query) {
      searchToken += 1;
      searching.value = false;
      resetSearchResults();
      return;
    }
    const root = path.value;
    const token = ++searchToken;
    searching.value = true;
    resetSearchResults();
    searchTimer = window.setTimeout(() => {
      searchTimer = undefined;
      void runSearch(query, root, token);
    }, delayMs);
  };

  const load = async (target = path.value) => {
    loading.value = true;
    error.value = null;
    try {
      const listing = await channel.listDirectory(target);
      path.value = listing.path;
      entries.value = listing.entries;
      loaded.value = true;
      selected.value = new Set();
      selectionAnchor.value = null;
      if (searchActive.value) scheduleSearch();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  };
  const refresh = async () => {
    let candidate = path.value;
    while (true) {
      await load(candidate);
      if (!error.value || candidate === '/') return;
      candidate = parentPath(candidate);
    }
  };
  const open = async (entry: RemoteFileEntry) => {
    if (entry.metadata.isDirectory) await load(entry.path);
  };
  const goParent = () => load(parentPath(path.value));
  const search = async () => {
    const query = searchQuery.value.trim();
    clearSearchTimer();
    if (!query) {
      searchToken += 1;
      searching.value = false;
      resetSearchResults();
      return;
    }
    const root = path.value;
    const token = ++searchToken;
    searching.value = true;
    resetSearchResults();
    await runSearch(query, root, token);
  };
  const clearSearch = () => {
    searchQuery.value = '';
    searchToken += 1;
    clearSearchTimer();
    searching.value = false;
    resetSearchResults();
  };
  const select = (entry: RemoteFileEntry, mode: 'only' | 'toggle' | 'range' = 'only') => {
    if (mode === 'range' && selectionAnchor.value) {
      const anchorIndex = visible.value.findIndex((item) => item.path === selectionAnchor.value);
      const targetIndex = visible.value.findIndex((item) => item.path === entry.path);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        selected.value = new Set(visible.value.slice(start, end + 1).map((item) => item.path));
        selectionAnchor.value = entry.path;
        return;
      }
    }
    if (mode === 'toggle') {
      const next = new Set(selected.value);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      selected.value = next;
      selectionAnchor.value = entry.path;
      return;
    }
    selected.value = new Set([entry.path]);
    selectionAnchor.value = entry.path;
  };
  const toggle = (entry: RemoteFileEntry) => select(entry, 'toggle');
  const selectAll = () => {
    selected.value = new Set(visible.value.map((entry) => entry.path));
    selectionAnchor.value = visible.value.at(-1)?.path ?? null;
  };
  const clearSelection = () => {
    selected.value = new Set();
    selectionAnchor.value = null;
  };
  const setSort = (key: FilesystemSortKey) => {
    if (sortKey.value === key) sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
    else {
      sortKey.value = key;
      sortDirection.value = 'asc';
    }
  };
  const stopSearchWatch = watch(searchQuery, () => {
    clearSelection();
    scheduleSearch();
  });
  const dispose = () => {
    stopSearchWatch();
    clearSearchTimer();
    searchToken += 1;
  };
  return {
    path,
    entries,
    searchEntries,
    visible,
    searchQuery,
    searchActive,
    searching,
    searchTruncated,
    searchError,
    loading,
    loaded,
    error,
    selected,
    selectionAnchor,
    sortKey,
    sortDirection,
    load,
    refresh,
    open,
    goParent,
    search,
    scheduleSearch,
    clearSearch,
    select,
    toggle,
    selectAll,
    clearSelection,
    setSort,
    dispose,
  };
}

export type FilesystemBrowserController = ReturnType<typeof useFilesystemBrowser>;
