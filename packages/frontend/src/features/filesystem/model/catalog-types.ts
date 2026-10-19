import type { Ref, ComputedRef } from 'vue';
import type { FavoritePathSort as SharedFavoritePathSort } from '@nexus-terminal/shared/preferences/favorites/values';

export type FavoritePathSort = SharedFavoritePathSort;

export interface FavoritePathSummary {
	id: number;
	version: number;
	name: string | null;
	path: string;
	lastUsedAt: number | null;
	createdAt: number;
	updatedAt: number;
}

export interface PathHistoryItem {
	id: number;
	path: string;
	timestamp: number;
}

export type FavoritePathSaveInput = { path: string; name: string | null } & (
	{ id?: never; expectedVersion?: never } | { id: number; expectedVersion: number }
);

export interface FilesystemCatalogController {
	favorites: Ref<FavoritePathSummary[]>;
	history: Ref<PathHistoryItem[]>;
	favoriteSort: Ref<FavoritePathSort>;
	favoriteSearch: Ref<string>;
	historySearch: Ref<string>;
	loadingFavorites: Ref<boolean>;
	loadingHistory: Ref<boolean>;
	filteredFavorites: ComputedRef<FavoritePathSummary[]>;
	filteredHistory: ComputedRef<PathHistoryItem[]>;
	loadFavorites(force?: boolean): Promise<void>;
	setFavoriteSort(sort: FavoritePathSort): Promise<void>;
	saveFavorite(input: FavoritePathSaveInput, permission?: AbortSignal): Promise<FavoritePathSummary>;
	removeFavorite(item: FavoritePathSummary, permission?: AbortSignal): Promise<void>;
	useFavorite(item: FavoritePathSummary, permission?: AbortSignal): Promise<void>;
	loadHistory(force?: boolean): Promise<void>;
	recordPath(path: string): Promise<void>;
	removeHistory(id: number): Promise<void>;
	clearHistory(): Promise<void>;
}
