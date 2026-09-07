import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type { Tag, TagRepository } from '../../../modules/tags/tag.repository.port';

type TagRow = { id: number; name: string; created_at: number; updated_at: number };
const mapTag = (row: TagRow): Tag => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class SqliteTagRepository implements TagRepository {
  constructor(private readonly db: RelationalDatabase) {}
  async list(): Promise<Tag[]> {
    return (await this.db.queryAll<TagRow>('SELECT id,name,created_at,updated_at FROM tags ORDER BY name ASC')).map(
      mapTag,
    );
  }
  async get(id: number): Promise<Tag | null> {
    const row = await this.db.queryOne<TagRow>('SELECT id,name,created_at,updated_at FROM tags WHERE id=?', [id]);
    return row ? mapTag(row) : null;
  }
  async create(name: string): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const r = await this.db.execute('INSERT INTO tags (name,created_at,updated_at) VALUES (?,?,?)', [name, now, now]);
    if (!r.lastInsertId) throw new Error('Tag insert did not return an id.');
    return r.lastInsertId;
  }
  async update(id: number, name: string): Promise<boolean> {
    return (
      (
        await this.db.execute('UPDATE tags SET name=?, updated_at=? WHERE id=?', [
          name,
          Math.floor(Date.now() / 1000),
          id,
        ])
      ).changes > 0
    );
  }
  async delete(id: number): Promise<boolean> {
    return (await this.db.execute('DELETE FROM tags WHERE id=?', [id])).changes > 0;
  }
  setConnections(tagId: number, connectionIds: readonly number[]): Promise<void> {
    return this.db.transaction(async (tx) => {
      await tx.execute('DELETE FROM connection_tags WHERE tag_id=?', [tagId]);
      for (const connectionId of connectionIds)
        await tx.execute('INSERT INTO connection_tags (tag_id,connection_id) VALUES (?,?)', [tagId, connectionId]);
    });
  }
}
