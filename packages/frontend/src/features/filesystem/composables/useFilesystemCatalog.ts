import { computed, ref } from 'vue';
import { filesystemCatalogApi } from '../api/filesystemCatalogApi';
import type { FavoritePath, FavoritePathSort, PathHistoryEntry } from '../model/catalog';

const favorites = ref<FavoritePath[]>([]);
const history = ref<PathHistoryEntry[]>([]);
const favoriteSort = ref<FavoritePathSort>(
  localStorage.getItem('favoritePathSortBy') === 'lastUsedAt' ? 'lastUsedAt' : 'name',
);
const favoritesLoaded = ref(false);
const historyLoaded = ref(false);
let favoritesLoad: Promise<void> | undefined;
let historyLoad: Promise<void> | undefined;

const sortFavorites = () => {
  favorites.value = [...favorites.value].sort((a, b) => {
    if (favoriteSort.value === 'lastUsedAt') return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    return (a.name || a.path).localeCompare(b.name || b.path);
  });
};

export function useFilesystemCatalog() {
  const favoriteSearch = ref('');
  const historySearch = ref('');
  const loadingFavorites = ref(false);
  const loadingHistory = ref(false);

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

  async function loadFavorites(force = false): Promise<void> {
    if (favoritesLoaded.value && !force) return;
    if (favoritesLoad && !force) return favoritesLoad;
    loadingFavorites.value = true;
    favoritesLoad = filesystemCatalogApi
      .listFavorites(favoriteSort.value)
      .then((items) => {
        favorites.value = items;
        sortFavorites();
        favoritesLoaded.value = true;
      })
      .finally(() => {
        loadingFavorites.value = false;
        favoritesLoad = undefined;
      });
    return favoritesLoad;
  }

  async function setFavoriteSort(sort: FavoritePathSort): Promise<void> {
    favoriteSort.value = sort;
    localStorage.setItem('favoritePathSortBy', sort);
    sortFavorites();
  }

  async function saveFavorite(input: { id?: number; path: string; name?: string | null }): Promise<FavoritePath> {
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

  async function useFavorite(item: FavoritePath): Promise<void> {
    const updated = await filesystemCatalogApi.touchFavorite(item.id);
    const index = favorites.value.findIndex((value) => value.id === item.id);
    if (index >= 0) favorites.value[index] = updated;
    sortFavorites();
  }

  async function loadHistory(force = false): Promise<void> {
    if (historyLoaded.value && !force) return;
    if (historyLoad && !force) return historyLoad;
    loadingHistory.value = true;
    historyLoad = filesystemCatalogApi
      .listHistory()
      .then((items) => {
        history.value = items;
        historyLoaded.value = true;
      })
      .finally(() => {
        loadingHistory.value = false;
        historyLoad = undefined;
      });
    return historyLoad;
  }

  async function recordPath(path: string): Promise<void> {
    const value = path.trim();
    if (!value) return;
    await filesystemCatalogApi.addHistory(value);
    history.value = await filesystemCatalogApi.listHistory();
    historyLoaded.value = true;
  }

  async function removeHistory(id: number): Promise<void> {
    await filesystemCatalogApi.removeHistory(id);
    history.value = history.value.filter((item) => item.id !== id);
  }

  async function clearHistory(): Promise<void> {
    await filesystemCatalogApi.clearHistory();
    history.value = [];
    historyLoaded.value = true;
  }

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
