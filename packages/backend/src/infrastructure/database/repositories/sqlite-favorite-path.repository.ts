import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type {
  FavoritePath,
  FavoritePathRepository,
  FavoritePathSort,
} from '../../../modules/favorite-paths/favorite-path.repository.port';

type FavoritePathRow = {
  id: number;
  name: string | null;
  path: string;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
};
const mapFavoritePath = (row: FavoritePathRow): FavoritePath => ({
  id: row.id,
  name: row.name,
  path: row.path,
  lastUsedAt: row.last_used_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

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
  async list(sortBy: FavoritePathSort = 'name'): Promise<FavoritePath[]> {
    const order = sortBy === 'lastUsedAt' ? 'last_used_at DESC, name ASC' : 'name ASC';
    return (
      await this.db.queryAll<FavoritePathRow>(
        `SELECT id,name,path,last_used_at,created_at,updated_at FROM favorite_paths ORDER BY ${order}`,
      )
    ).map(mapFavoritePath);
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
  async get(id: number): Promise<FavoritePath | null> {
    const row = await this.db.queryOne<FavoritePathRow>(
      'SELECT id,name,path,last_used_at,created_at,updated_at FROM favorite_paths WHERE id=?',
      [id],
    );
    return row ? mapFavoritePath(row) : null;
  }
}
