import type { FavoritePath } from '@nexus-terminal/shared/preferences/favorites/model';
import type { PathHistoryEntry } from '@nexus-terminal/shared/preferences/history/model';
import type { FavoritePathSummary, PathHistoryItem } from './catalog-types';

export function fromFavorite(value: FavoritePath): FavoritePathSummary {
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		path: value.path,
		lastUsedAt: value.lastUsedAt,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function fromPathHistory(value: PathHistoryEntry): PathHistoryItem {
	return { id: value.id, path: value.path, timestamp: value.timestamp };
}
