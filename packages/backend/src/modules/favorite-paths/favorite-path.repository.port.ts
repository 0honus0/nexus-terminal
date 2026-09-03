export interface FavoritePath {
  id: number;
  name: string | null;
  path: string;
  last_used_at?: number | null;
  created_at: number;
  updated_at: number;
}
export type FavoritePathSort = 'name' | 'last_used_at';
export interface FavoritePathRepository {
  create(name: string | null, path: string): Promise<number>;
  update(id: number, name: string | null, path: string): Promise<boolean>;
  delete(id: number): Promise<boolean>;
  list(sortBy?: FavoritePathSort): Promise<FavoritePath[]>;
  touch(id: number): Promise<boolean>;
  get(id: number): Promise<FavoritePath | null>;
}
