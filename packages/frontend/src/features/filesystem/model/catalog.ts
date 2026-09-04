export interface FavoritePath {
  id: number;
  name: string | null;
  path: string;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type FavoritePathSort = 'name' | 'lastUsedAt';

export interface PathHistoryEntry {
  id: number;
  path: string;
  timestamp: number;
}
