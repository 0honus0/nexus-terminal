import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { defineStore, storeToRefs } from 'pinia';
import { readStoredValue, stringStorageCodec, writeStoredValue } from '@/foundation/browser';
import { filesystemCatalogApi } from '../api/filesystemCatalogApi';
import type { FavoritePathDto, FavoritePathSortDto, PathHistoryEntryDto } from '../model/catalog';

export interface FavoritePathSaveInput {
  id?: number;
  path: string;
  name?: string | null;
}

const favoriteSortStorage = {
  namespace: 'filesystem.favorite-sort',
  version: 1,
  codec: stringStorageCodec((value) => value === 'name' || value === 'lastUsedAt'),
  legacyKeys: ['favoritePathSortBy'],
} as const;

export interface FilesystemCatalogController {
  favorites: Ref<FavoritePathDto[]>;
  history: Ref<PathHistoryEntryDto[]>;
  favoriteSort: Ref<FavoritePathSortDto>;
  favoriteSearch: Ref<string>;
  historySearch: Ref<string>;
  loadingFavorites: Ref<boolean>;
  loadingHistory: Ref<boolean>;
  filteredFavorites: ComputedRef<FavoritePathDto[]>;
  filteredHistory: ComputedRef<PathHistoryEntryDto[]>;
  loadFavorites(force?: boolean): Promise<void>;
  setFavoriteSort(sort: FavoritePathSortDto): Promise<void>;
  saveFavorite(input: FavoritePathSaveInput): Promise<FavoritePathDto>;
  removeFavorite(id: number): Promise<void>;
  useFavorite(item: FavoritePathDto): Promise<void>;
  loadHistory(force?: boolean): Promise<void>;
  recordPath(path: string): Promise<void>;
  removeHistory(id: number): Promise<void>;
  clearHistory(): Promise<void>;
}

export const useFilesystemCatalogStore = defineStore('filesystem-catalog', () => {
  const favorites = ref<FavoritePathDto[]>([]);
  const history = ref<PathHistoryEntryDto[]>([]);
  const favoriteSort = ref<FavoritePathSortDto>(
    readStoredValue(favoriteSortStorage) === 'lastUsedAt' ? 'lastUsedAt' : 'name',
  );
  const favoritesLoaded = ref(false);
  const loadingFavorites = ref(false);
  const loadingHistory = ref(false);
  const historyLoaded = ref(false);
  let favoritesLoad: Promise<void> | undefined;
  let historyLoad: Promise<void> | undefined;
  let historyMutation: Promise<void> = Promise.resolve();
  let catalogGeneration = 0;

  const enqueueHistoryOperation = (operation: () => Promise<void>): Promise<void> => {
    const next = historyMutation.then(operation, operation);
    historyMutation = next.catch(() => undefined);
    return next;
  };

  const sortFavorites = () => {
    favorites.value = [...favorites.value].sort((a, b) => {
      if (favoriteSort.value === 'lastUsedAt') return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
      return (a.name || a.path).localeCompare(b.name || b.path);
    });
  };

  async function loadFavorites(force = false): Promise<void> {
    if (favoritesLoaded.value && !force) return;
    if (favoritesLoad && !force) return favoritesLoad;
    loadingFavorites.value = true;
    const generation = catalogGeneration;
    favoritesLoad = filesystemCatalogApi
      .listFavorites(favoriteSort.value)
      .then((items) => {
        if (generation !== catalogGeneration) return;
        favorites.value = items;
        sortFavorites();
        favoritesLoaded.value = true;
      })
      .finally(() => {
        if (generation !== catalogGeneration) return;
        loadingFavorites.value = false;
        favoritesLoad = undefined;
      });
    return favoritesLoad;
  }

  async function setFavoriteSort(sort: FavoritePathSortDto): Promise<void> {
    favoriteSort.value = sort;
    writeStoredValue(favoriteSortStorage, sort);
    sortFavorites();
  }

  async function saveFavorite(input: FavoritePathSaveInput): Promise<FavoritePathDto> {
    const item = input.id
      ? await filesystemCatalogApi.updateFavorite(input.id, input.path, input.name?.trim() || null)
      : await filesystemCatalogApi.addFavorite(input.path, input.name?.trim() || null);
    const index = favorites.value.findIndex((value) => value.id === item.id);
    if (index >= 0) favorites.value[index] = item;
    else favorites.value.push(item);
    sortFavorites();
    favoritesLoaded.value = true;
    return item;
  }

  async function removeFavorite(id: number): Promise<void> {
    await filesystemCatalogApi.removeFavorite(id);
    favorites.value = favorites.value.filter((item) => item.id !== id);
  }

  async function useFavorite(item: FavoritePathDto): Promise<void> {
    const updated = await filesystemCatalogApi.touchFavorite(item.id);
    const index = favorites.value.findIndex((value) => value.id === item.id);
    if (index >= 0) favorites.value[index] = updated;
    sortFavorites();
  }

  async function loadHistory(force = false): Promise<void> {
    if (historyLoad && !force) return historyLoad;
    loadingHistory.value = true;
    const generation = catalogGeneration;
    historyLoad = enqueueHistoryOperation(async () => {
      if (generation !== catalogGeneration) return;
      if (historyLoaded.value && !force) return;
      const incoming = await filesystemCatalogApi.listHistory();
      if (generation !== catalogGeneration) return;
      history.value = incoming;
      historyLoaded.value = true;
    }).finally(() => {
      if (generation !== catalogGeneration) return;
      loadingHistory.value = false;
      historyLoad = undefined;
    });
    return historyLoad;
  }

  async function recordPath(path: string): Promise<void> {
    if (!path.trim()) return;
    const generation = catalogGeneration;
    return enqueueHistoryOperation(async () => {
      if (generation !== catalogGeneration) return;
      await filesystemCatalogApi.addHistory(path);
      const incoming = await filesystemCatalogApi.listHistory();
      if (generation !== catalogGeneration) return;
      history.value = incoming;
      historyLoaded.value = true;
    });
  }

  async function removeHistory(id: number): Promise<void> {
    const generation = catalogGeneration;
    return enqueueHistoryOperation(async () => {
      if (generation !== catalogGeneration) return;
      await filesystemCatalogApi.removeHistory(id);
      if (generation !== catalogGeneration) return;
      history.value = history.value.filter((item) => item.id !== id);
    });
  }

  async function clearHistory(): Promise<void> {
    const generation = catalogGeneration;
    return enqueueHistoryOperation(async () => {
      if (generation !== catalogGeneration) return;
      await filesystemCatalogApi.clearHistory();
      if (generation !== catalogGeneration) return;
      history.value = [];
      historyLoaded.value = true;
    });
  }

  function reset(): void {
    catalogGeneration += 1;
    favorites.value = [];
    history.value = [];
    favoritesLoaded.value = false;
    historyLoaded.value = false;
    loadingFavorites.value = false;
    loadingHistory.value = false;
    favoritesLoad = undefined;
    historyLoad = undefined;
    historyMutation = Promise.resolve();
  }

  return {
    favorites,
    history,
    favoriteSort,
    loadingFavorites,
    loadingHistory,
    loadFavorites,
    setFavoriteSort,
    saveFavorite,
    removeFavorite,
    useFavorite,
    loadHistory,
    recordPath,
    removeHistory,
    clearHistory,
    reset,
  };
});

export function useFilesystemCatalog(): FilesystemCatalogController {
  const store = useFilesystemCatalogStore();
  const { favorites, history, favoriteSort, loadingFavorites, loadingHistory } = storeToRefs(store);
  const {
    loadFavorites,
    setFavoriteSort,
    saveFavorite,
    removeFavorite,
    useFavorite,
    loadHistory,
    recordPath,
    removeHistory,
    clearHistory,
  } = store;
  const favoriteSearch = ref('');
  const historySearch = ref('');

  const filteredFavorites = computed(() => {
    const term = favoriteSearch.value.trim().toLowerCase();
    if (!term) return favorites.value;
    return favorites.value.filter((item) => `${item.name ?? ''} ${item.path}`.toLowerCase().includes(term));
  });
  const filteredHistory = computed(() => {
    const term = historySearch.value.trim().toLowerCase();
    const source = [...history.value].sort((a, b) => b.timestamp - a.timestamp);
    return term ? source.filter((item) => item.path.toLowerCase().includes(term)) : source;
  });

  return {
    favorites,
    history,
    favoriteSort,
    favoriteSearch,
    historySearch,
    loadingFavorites,
    loadingHistory,
    filteredFavorites,
    filteredHistory,
    loadFavorites,
    setFavoriteSort,
    saveFavorite,
    removeFavorite,
    useFavorite,
    loadHistory,
    recordPath,
    removeHistory,
    clearHistory,
  };
}
