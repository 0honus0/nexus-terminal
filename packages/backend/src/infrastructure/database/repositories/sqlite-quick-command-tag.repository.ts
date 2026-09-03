import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type {
  QuickCommandTag,
  QuickCommandTagRepository,
} from '../../../modules/quick-command-tags/quick-command-tag.repository.port';
export class SqliteQuickCommandTagRepository implements QuickCommandTagRepository {
  constructor(private readonly db: RelationalDatabase) {}
  list(): Promise<QuickCommandTag[]> {
    return this.db.queryAll('SELECT * FROM quick_command_tags ORDER BY name ASC');
  }
  get(id: number): Promise<QuickCommandTag | null> {
    return this.db.queryOne('SELECT * FROM quick_command_tags WHERE id=?', [id]);
  }
  async create(name: string): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const r = await this.db.execute('INSERT INTO quick_command_tags (name,created_at,updated_at) VALUES (?,?,?)', [
      name,
      now,
      now,
    ]);
    if (!r.lastInsertId) throw new Error('Quick command tag insert did not return an id.');
    return r.lastInsertId;
  }
  async update(id: number, name: string): Promise<boolean> {
    return (
      (
        await this.db.execute('UPDATE quick_command_tags SET name=?,updated_at=? WHERE id=?', [
          name,
          Math.floor(Date.now() / 1000),
          id,
        ])
      ).changes > 0
    );
  }
  async delete(id: number): Promise<boolean> {
    return (await this.db.execute('DELETE FROM quick_command_tags WHERE id=?', [id])).changes > 0;
  }
  setCommandTags(commandId: number, tagIds: readonly number[]): Promise<void> {
    return this.db.transaction(async (tx) => {
      await tx.execute('DELETE FROM quick_command_tag_associations WHERE quick_command_id=?', [commandId]);
      for (const tagId of tagIds)
        if (Number.isFinite(tagId))
          await tx.execute('INSERT INTO quick_command_tag_associations (quick_command_id,tag_id) VALUES (?,?)', [
            commandId,
            tagId,
          ]);
    });
  }
  addTagToCommands(commandIds: readonly number[], tagId: number): Promise<void> {
    return this.db.transaction(async (tx) => {
      for (const commandId of commandIds)
        if (Number.isFinite(commandId))
          await tx.execute(
            'INSERT OR IGNORE INTO quick_command_tag_associations (quick_command_id,tag_id) VALUES (?,?)',
            [commandId, tagId],
          );
    });
  }
  listForCommand(commandId: number): Promise<QuickCommandTag[]> {
    return this.db.queryAll(
      'SELECT t.id,t.name,t.created_at,t.updated_at FROM quick_command_tags t JOIN quick_command_tag_associations a ON t.id=a.tag_id WHERE a.quick_command_id=? ORDER BY t.name ASC',
      [commandId],
    );
  }
}
