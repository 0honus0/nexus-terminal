import type { FavoritePath } from './model.js';
import type { FavoritePathSort, FavoriteErrorCode } from './values.js';

export interface FavoritePathCreateRequest {
	name: string | null;
	path: string;
}

export interface FavoritePathUpdateRequest {
	expectedVersion: number;
	name: string | null;
	path: string;
}

export interface FavoritePathVersionRequest {
	expectedVersion: number;
}

export interface FavoritePathListQuery {
	sortBy: FavoritePathSort;
	offset: number;
	limit: number;
}

export interface FavoritePathListResponse {
	entries: FavoritePath[];
	nextOffset: number | null;
}

export interface FavoritePathMutationResponse {
	favoritePath: FavoritePath;
}

export interface FavoritePathDeleteResponse {
	deleted: true;
}

export interface FavoritePathErrorResponse {
	code: FavoriteErrorCode;
}
