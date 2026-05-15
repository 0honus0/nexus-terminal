import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';
import { useUiNotificationsStore } from './uiNotifications.store';
import { log } from '@/utils/log';

export type FavoritePathSortType = 'name' | 'last_used_at';

export interface FavoritePathItem {
  id: number;
  path: string;
  name: string | null;
  last_used_at?: number | null;
  created_at: number;
}

export const useFavoritePathsStore = defineStore('favoritePaths', () => {
  const VALID_SORT_TYPES: FavoritePathSortType[] = ['name', 'last_used_at'];
  const savedSortByRaw = localStorage.getItem('favoritePathSortBy');
  const savedSortBy = VALID_SORT_TYPES.includes(savedSortByRaw as FavoritePathSortType)
    ? (savedSortByRaw as FavoritePathSortType)
    : null;

  // --- State ---
  const favoritePaths = ref<FavoritePathItem[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const searchTerm = ref('');
  const currentSortBy = ref<FavoritePathSortType>(savedSortBy || 'name');
  const isInitialized = ref(false);

  // --- Getters ---
  const filteredFavoritePaths = computed((): FavoritePathItem[] => {
    if (!searchTerm.value) {
      return favoritePaths.value;
    }
    const lowerCaseSearchTerm = searchTerm.value.toLowerCase();
    return favoritePaths.value.filter(
      (fav) =>
        fav.path.toLowerCase().includes(lowerCaseSearchTerm) ||
        (fav.name && fav.name.toLowerCase().includes(lowerCaseSearchTerm))
    );
  });

  function getFavoritePathById(id: number) {
    return favoritePaths.value.find((fav) => fav.id === id);
  }

  // --- Actions ---
  function _sortFavoritePaths() {
    favoritePaths.value.sort((a, b) => {
      if (currentSortBy.value === 'name') {
        const nameA = a.name?.toLowerCase() || a.path.toLowerCase();
        const nameB = b.name?.toLowerCase() || b.path.toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
      }
      if (currentSortBy.value === 'last_used_at') {
        const timeA = a.last_used_at ?? 0;
        const timeB = b.last_used_at ?? 0;
        return timeB - timeA;
      }
      return 0;
    });
  }

  function setSearchTerm(term: string) {
    searchTerm.value = term;
  }

  async function initializeFavoritePaths(t: (key: string, defaultMessage: string) => string) {
    if (isInitialized.value) {
      return;
    }
    isInitialized.value = true;
    await fetchFavoritePaths(t);
  }

  async function fetchFavoritePaths(_t: (key: string, defaultMessage: string) => string) {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await apiClient.get<FavoritePathItem[]>('/favorite-paths');
      favoritePaths.value = response.data;
      _sortFavoritePaths();
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, 'Failed to fetch favorite paths');
      log.error('Error fetching favorite paths:', err);
      isInitialized.value = false;
    } finally {
      isLoading.value = false;
    }
  }

  function setSortBy(sortBy: FavoritePathSortType) {
    currentSortBy.value = sortBy;
    localStorage.setItem('favoritePathSortBy', sortBy);
    _sortFavoritePaths();
  }

  async function markPathAsUsed(
    pathId: number,
    t: (key: string, defaultMessage: string) => string
  ) {
    const notificationsStore = useUiNotificationsStore();
    try {
      const response = await apiClient.put<{ message: string; favoritePath: FavoritePathItem }>(
        `/favorite-paths/${pathId}/update-last-used`
      );
      const updatedPath = response.data.favoritePath;
      if (updatedPath) {
        const index = favoritePaths.value.findIndex((p) => p.id === pathId);
        if (index !== -1) {
          favoritePaths.value[index] = updatedPath;
        } else {
          favoritePaths.value.push(updatedPath);
        }
        _sortFavoritePaths();
      } else {
        log.warn('markPathAsUsed did not receive updated path, re-fetching list.');
        await fetchFavoritePaths(t);
      }
    } catch (err: unknown) {
      log.error(`Error marking path ${pathId} as used:`, err);
      notificationsStore.addNotification({
        message: t('favoritePaths.notifications.markAsUsedError', 'Failed to mark path as used.'),
        type: 'error',
      });
    }
  }

  async function addFavoritePath(
    newPathData: Omit<FavoritePathItem, 'id' | 'created_at' | 'last_used_at'>,
    t: (key: string, defaultMessage: string) => string
  ) {
    isLoading.value = true;
    error.value = null;
    const notificationsStore = useUiNotificationsStore();
    try {
      const response = await apiClient.post<{ message: string; favoritePath: FavoritePathItem }>(
        '/favorite-paths',
        newPathData
      );
      favoritePaths.value.push(response.data.favoritePath);
      _sortFavoritePaths();
      notificationsStore.addNotification({
        message: t('favoritePaths.notifications.addSuccess', 'Favorite path added successfully.'),
        type: 'success',
      });
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, 'Failed to add favorite path');
      log.error('Error adding favorite path:', err);
      notificationsStore.addNotification({
        message: t('favoritePaths.notifications.addError', 'Failed to add favorite path.'),
        type: 'error',
      });
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateFavoritePath(
    id: number,
    updatedPathData: Partial<Omit<FavoritePathItem, 'id' | 'created_at' | 'last_used_at'>>,
    t: (key: string, defaultMessage: string) => string
  ) {
    isLoading.value = true;
    error.value = null;
    const notificationsStore = useUiNotificationsStore();
    try {
      const response = await apiClient.put<{ message: string; favoritePath: FavoritePathItem }>(
        `/favorite-paths/${id}`,
        updatedPathData
      );
      const index = favoritePaths.value.findIndex((fav) => fav.id === id);
      if (index !== -1) {
        favoritePaths.value[index] = response.data.favoritePath;
        _sortFavoritePaths();
      }
      notificationsStore.addNotification({
        message: t(
          'favoritePaths.notifications.updateSuccess',
          'Favorite path updated successfully.'
        ),
        type: 'success',
      });
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, 'Failed to update favorite path');
      log.error('Error updating favorite path:', err);
      notificationsStore.addNotification({
        message: t('favoritePaths.notifications.updateError', 'Failed to update favorite path.'),
        type: 'error',
      });
      throw err;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteFavoritePath(
    id: number,
    t: (key: string, defaultMessage: string) => string
  ) {
    isLoading.value = true;
    error.value = null;
    const notificationsStore = useUiNotificationsStore();
    try {
      await apiClient.delete(`/favorite-paths/${id}`);
      favoritePaths.value = favoritePaths.value.filter((fav) => fav.id !== id);
      notificationsStore.addNotification({
        message: t(
          'favoritePaths.notifications.deleteSuccess',
          'Favorite path deleted successfully.'
        ),
        type: 'success',
      });
    } catch (err: unknown) {
      error.value = extractErrorMessage(err, 'Failed to delete favorite path');
      log.error('Error deleting favorite path:', err);
      notificationsStore.addNotification({
        message: t('favoritePaths.notifications.deleteError', 'Failed to delete favorite path.'),
        type: 'error',
      });
    } finally {
      isLoading.value = false;
    }
  }

  return {
    favoritePaths,
    isLoading,
    error,
    searchTerm,
    currentSortBy,
    isInitialized,
    filteredFavoritePaths,
    getFavoritePathById,
    setSearchTerm,
    initializeFavoritePaths,
    fetchFavoritePaths,
    setSortBy,
    markPathAsUsed,
    addFavoritePath,
    updateFavoritePath,
    deleteFavoritePath,
    // 向后兼容：测试直接调用排序方法
    _sortFavoritePaths,
  };
});
