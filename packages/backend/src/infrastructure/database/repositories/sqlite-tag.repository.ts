import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type { Tag, TagRepository } from '../../../modules/tags/tag.repository.port';
export class SqliteTagRepository implements TagRepository {
  constructor(private readonly db: RelationalDatabase) {}
  list(): Promise<Tag[]> {
    return this.db.queryAll('SELECT * FROM tags ORDER BY name ASC');
  }
  get(id: number): Promise<Tag | null> {
    return this.db.queryOne('SELECT * FROM tags WHERE id=?', [id]);
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
