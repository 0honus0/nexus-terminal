import type { FavoritePath, FavoritePathRepository, FavoritePathSort } from './favorite-path.repository.port';
export class FavoritePathService {
  constructor(private readonly repository: FavoritePathRepository) {}
  add(name: string | null, path: string): Promise<number> {
    return this.repository.create(name, path);
  }
  update(id: number, name: string | null, path: string): Promise<boolean> {
    return this.repository.update(id, name, path);
  }
  delete(id: number): Promise<boolean> {
    return this.repository.delete(id);
  }
  list(sortBy: FavoritePathSort = 'name'): Promise<FavoritePath[]> {
    return this.repository.list(sortBy);
  }
  touch(id: number): Promise<boolean> {
    return this.repository.touch(id);
  }
  get(id: number): Promise<FavoritePath | null> {
    return this.repository.get(id);
  }
}
