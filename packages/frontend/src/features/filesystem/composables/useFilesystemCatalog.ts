import type { FilesystemCatalogController } from '../model/catalog-types';
import { computed, ref } from 'vue';
import { defineStore, storeToRefs } from 'pinia';
import { readStoredValue, stringStorageCodec, writeStoredValue } from '@/foundation/browser';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { PreferenceRequestFailure } from '@/client/preferences/preference-request';
import { filesystemCatalogApi } from '../api/filesystem-catalog-api';
import type {
	FavoritePathSummary,
	FavoritePathSort,
	FavoritePathSaveInput,
	PathHistoryItem,
} from '../model/catalog-types';

const favoriteSortStorage = {
	namespace: 'filesystem.favorite-sort',
	version: 1,
	codec: stringStorageCodec((value) => value === 'name' || value === 'lastUsedAt'),
} as const;

export const useFilesystemCatalogStore = defineStore('filesystem-catalog', () => {
	const favorites = ref<FavoritePathSummary[]>([]),
		history = ref<PathHistoryItem[]>([]);
	const favoriteSort = ref<FavoritePathSort>(
		readStoredValue(favoriteSortStorage) === 'lastUsedAt' ? 'lastUsedAt' : 'name',
	);
	const loadingFavorites = ref(false),
		loadingHistory = ref(false);
	let favoritesLoaded = false,
		historyLoaded = false;
	let scope = new AbortController();
	let queue: Promise<unknown> = Promise.resolve();
	let favoriteRecovery = 0,
		historyRecovery = 0;
	let favoriteBlocked = false,
		historyBlocked = false;

	function enqueue<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const signal = scope.signal;
		const task = queue.then(() => {
			if (signal.aborted) {
				throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
			}
			return operation(signal);
		});
		queue = task.catch(() => undefined);
		return task;
	}

	function sortFavorites(): void {
		favorites.value = [...favorites.value].sort((a, b) =>
			favoriteSort.value === 'lastUsedAt'
				? (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
				: (a.name || a.path).localeCompare(b.name || b.path),
		);
	}

	function loadFavorites(force = false): Promise<void> {
		const recovery = favoriteRecovery;
		return enqueue(async (signal) => {
			if (favoritesLoaded && !force) {
				return;
			}
			loadingFavorites.value = true;
			try {
				const entries = await filesystemCatalogApi.listFavorites(favoriteSort.value, signal);
				if (signal.aborted) {
					return;
				}
				favorites.value = entries;
				favoritesLoaded = true;
				sortFavorites();
				if (force && recovery === favoriteRecovery) {
					favoriteBlocked = false;
				}
			} finally {
				if (!signal.aborted) {
					loadingFavorites.value = false;
				}
			}
		});
	}

	async function setFavoriteSort(sort: FavoritePathSort): Promise<void> {
		favoriteSort.value = sort;
		writeStoredValue(favoriteSortStorage, sort);
		sortFavorites();
	}

	function mutateFavorite<T>(operation: (signal: AbortSignal) => Promise<T>, permission?: AbortSignal): Promise<T> {
		return enqueue(async (signal) => {
			if (permission?.aborted) {
				throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
			}
			if (favoriteBlocked) {
				throw new PreferenceRequestFailure('refresh_required', 'not_dispatched');
			}
			favoritesLoaded = false;
			try {
				return await operation(signal);
			} catch (cause) {
				if (
					!signal.aborted &&
					cause instanceof PreferenceRequestFailure &&
					(cause.outcome === 'unknown' || cause.code === 'version_conflict' || cause.code === 'not_found')
				) {
					favoriteBlocked = true;
					favoriteRecovery += 1;
				}
				throw cause;
			}
		});
	}

	function saveFavorite(input: FavoritePathSaveInput, permission?: AbortSignal): Promise<FavoritePathSummary> {
		return mutateFavorite(async (signal) => {
			const name = input.name?.trim() || null;
			const item =
				input.id === undefined
					? await filesystemCatalogApi.addFavorite(input.path, name, signal)
					: await filesystemCatalogApi.updateFavorite(
							input.id,
							input.expectedVersion,
							input.path,
							name,
							signal,
						);
			if (!signal.aborted) {
				const index = favorites.value.findIndex((value) => value.id === item.id);
				if (index < 0) {
					favorites.value.push(item);
				} else {
					favorites.value[index] = item;
				}
				sortFavorites();
			}
			return item;
		}, permission);
	}

	function removeFavorite(item: FavoritePathSummary, permission?: AbortSignal): Promise<void> {
		return mutateFavorite(async (signal) => {
			await filesystemCatalogApi.removeFavorite(item, signal);
			if (!signal.aborted) {
				favorites.value = favorites.value.filter((value) => value.id !== item.id);
			}
		}, permission);
	}

	function useFavorite(item: FavoritePathSummary, permission?: AbortSignal): Promise<void> {
		return mutateFavorite(async (signal) => {
			const updated = await filesystemCatalogApi.touchFavorite(item, signal);
			if (!signal.aborted) {
				const index = favorites.value.findIndex((value) => value.id === item.id);
				if (index >= 0) {
					favorites.value[index] = updated;
				}
				sortFavorites();
			}
		}, permission);
	}

	function loadHistory(force = false): Promise<void> {
		const recovery = historyRecovery;
		return enqueue(async (signal) => {
			if (historyLoaded && !force) {
				return;
			}
			loadingHistory.value = true;
			try {
				const entries = await filesystemCatalogApi.listHistory(signal);
				if (signal.aborted) {
					return;
				}
				history.value = entries;
				historyLoaded = true;
				if (force && recovery === historyRecovery) {
					historyBlocked = false;
				}
			} finally {
				if (!signal.aborted) {
					loadingHistory.value = false;
				}
			}
		});
	}

	function mutateHistory(operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
		return enqueue(async (signal) => {
			if (historyBlocked) {
				throw new PreferenceRequestFailure('refresh_required', 'not_dispatched');
			}
			historyLoaded = false;
			try {
				await operation(signal);
			} catch (cause) {
				if (!signal.aborted && cause instanceof PreferenceRequestFailure && cause.outcome === 'unknown') {
					historyBlocked = true;
					historyRecovery += 1;
				}
				throw cause;
			}
		});
	}

	function recordPath(path: string): Promise<void> {
		if (!path.trim()) {
			return Promise.resolve();
		}
		return mutateHistory(async (signal) => {
			await filesystemCatalogApi.addHistory(path, signal);
			// The confirmed append invalidates the projection; reopening history performs a separate read.
		});
	}

	function removeHistory(id: number): Promise<void> {
		return mutateHistory(async (signal) => {
			await filesystemCatalogApi.removeHistory(id, signal);
			if (!signal.aborted) {
				history.value = history.value.filter((entry) => entry.id !== id);
			}
		});
	}

	function clearHistory(): Promise<void> {
		return mutateHistory(async (signal) => {
			await filesystemCatalogApi.clearHistory(signal);
			if (!signal.aborted) {
				history.value = [];
				historyLoaded = true;
			}
		});
	}

	function reset(): void {
		scope.abort();
		scope = new AbortController();
		queue = Promise.resolve();
		favorites.value = [];
		history.value = [];
		favoritesLoaded = false;
		historyLoaded = false;
		loadingFavorites.value = false;
		loadingHistory.value = false;
		favoriteBlocked = false;
		historyBlocked = false;
		favoriteRecovery += 1;
		historyRecovery += 1;
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

registerAuthenticatedSessionReset('filesystem-catalog-cache', () => useFilesystemCatalogStore().reset());

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
		if (!term) {
			return favorites.value;
		}
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
