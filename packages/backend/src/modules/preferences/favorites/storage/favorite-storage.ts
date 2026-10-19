import type { FavoritePathSort } from '@nexus-terminal/shared/preferences/favorites/values';

export interface StoredFavoriteInput {
	name: string | null;
	path: string;
}

export interface StoredFavorite {
	id: number;
	version: number;
	name: string | null;
	path: string;
	lastUsedAt: number | null;
	createdAt: number;
	updatedAt: number;
}

export interface FavoriteAuthorization {
	sessionDigest: string;
	admit(userId: number | null): void;
}

export interface FavoriteCreateCommand {
	userId: number;
	input: StoredFavoriteInput;
}

export interface FavoriteVersionCommand {
	userId: number;
	id: number;
	expectedVersion: number;
}

export interface FavoriteTouchCommand {
	userId: number;
	id: number;
	expectedVersion: number;
}

export interface FavoriteUpdateCommand {
	userId: number;
	id: number;
	expectedVersion: number;
	input: StoredFavoriteInput;
}

export type FavoriteMutation =
	{ status: 'updated'; value: StoredFavorite } | { status: 'not_found' } | { status: 'version_conflict' };

export type FavoriteDeletion = { status: 'deleted' } | { status: 'not_found' } | { status: 'version_conflict' };

export interface FavoriteStorage {
	list(userId: number, sortBy: FavoritePathSort, offset: number, limit: number): Promise<StoredFavorite[]>;
	get(userId: number, id: number): Promise<StoredFavorite | null>;
	create(
		command: FavoriteCreateCommand,
		authorization: FavoriteAuthorization,
		admitCount: (count: number) => void,
	): Promise<StoredFavorite>;
	update(command: FavoriteUpdateCommand, authorization: FavoriteAuthorization): Promise<FavoriteMutation>;
	touch(command: FavoriteTouchCommand, authorization: FavoriteAuthorization): Promise<FavoriteMutation>;
	delete(command: FavoriteVersionCommand, authorization: FavoriteAuthorization): Promise<FavoriteDeletion>;
}
