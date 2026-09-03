export interface FavoritePath {
  id: number;
  path: string;
  name?: string;
}

export interface FavoritePathService {
  list(): Promise<FavoritePath[]>;
}
