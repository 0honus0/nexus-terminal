import type { FavoritePathSort } from '@nexus-terminal/shared/preferences/favorites/values';

export interface FavoriteActor {
	userId: number;
	token: string;
}

export interface FavoriteIdentity {
	userId: number | null;
}

export interface FavoriteInput {
	name: string | null;
	path: string;
}

export interface FavoriteUpdate {
	id: number;
	expectedVersion: number;
	input: FavoriteInput;
}

export interface FavoriteRecord {
	id: number;
	version: number;
	name: string | null;
	path: string;
	lastUsedAt: number | null;
	createdAt: number;
	updatedAt: number;
}

export interface FavoriteQuery {
	sortBy: FavoritePathSort;
	offset: number;
	limit: number;
}

export interface FavoritePage {
	entries: FavoriteRecord[];
	nextOffset: number | null;
}

export interface FavoriteCreationFacts {
	count: number;
}

export interface FavoriteCreate {
	input: FavoriteInput;
	at: number;
}

export interface FavoriteChange {
	id: number;
	expectedVersion: number;
	input: FavoriteInput;
	at: number;
}

export interface FavoriteTouch {
	id: number;
	expectedVersion: number;
	at: number;
}

export interface FavoriteDelete {
	id: number;
	expectedVersion: number;
}
