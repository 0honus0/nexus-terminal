export interface FavoritePath {
  id: number;
  name: string | null;
  path: string;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
export type FavoritePathSort = 'name' | 'lastUsedAt';
export interface FavoritePathRepository {
  create(name: string | null, path: string): Promise<number>;
  update(id: number, name: string | null, path: string): Promise<boolean>;
  delete(id: number): Promise<boolean>;
  list(sortBy?: FavoritePathSort): Promise<FavoritePath[]>;
  touch(id: number): Promise<boolean>;
  get(id: number): Promise<FavoritePath | null>;
}
