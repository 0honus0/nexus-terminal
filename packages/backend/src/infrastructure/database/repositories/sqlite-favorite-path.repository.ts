import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type {
  FavoritePath,
  FavoritePathRepository,
  FavoritePathSort,
} from '../../../modules/favorite-paths/favorite-path.repository.port';
export class SqliteFavoritePathRepository implements FavoritePathRepository {
  constructor(private readonly db: RelationalDatabase) {}
  async create(name: string | null, remotePath: string): Promise<number> {
    const result = await this.db.execute(
      "INSERT INTO favorite_paths (name, path, created_at, updated_at) VALUES (?, ?, strftime('%s','now'), strftime('%s','now'))",
      [name, remotePath],
    );
    if (!result.lastInsertId) throw new Error('Favorite path insert did not return an id.');
    return result.lastInsertId;
  }
  async update(id: number, name: string | null, remotePath: string): Promise<boolean> {
    return (
      (
        await this.db.execute("UPDATE favorite_paths SET name=?, path=?, updated_at=strftime('%s','now') WHERE id=?", [
          name,
          remotePath,
          id,
        ])
      ).changes > 0
    );
  }
  async delete(id: number): Promise<boolean> {
    return (await this.db.execute('DELETE FROM favorite_paths WHERE id=?', [id])).changes > 0;
  }
  list(sortBy: FavoritePathSort = 'name'): Promise<FavoritePath[]> {
    const order = sortBy === 'last_used_at' ? 'last_used_at DESC, name ASC' : 'name ASC';
    return this.db.queryAll(
      `SELECT id,name,path,last_used_at,created_at,updated_at FROM favorite_paths ORDER BY ${order}`,
    );
  }
  async touch(id: number): Promise<boolean> {
    return (
      (
        await this.db.execute(
          "UPDATE favorite_paths SET last_used_at=strftime('%s','now'), updated_at=strftime('%s','now') WHERE id=?",
          [id],
        )
      ).changes > 0
    );
  }
  get(id: number): Promise<FavoritePath | null> {
    return this.db.queryOne('SELECT id,name,path,last_used_at,created_at,updated_at FROM favorite_paths WHERE id=?', [
      id,
    ]);
  }
}
