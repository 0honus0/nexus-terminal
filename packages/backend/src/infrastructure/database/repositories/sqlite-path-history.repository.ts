import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type {
  PathHistoryEntry,
  PathHistoryRepository,
} from '../../../modules/path-history/path-history.repository.port';
export class SqlitePathHistoryRepository implements PathHistoryRepository {
  constructor(private readonly db: RelationalDatabase) {}
  async upsert(remotePath: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const now = Math.floor(Date.now() / 1000);
      const row = await tx.queryOne<{ id: number }>(
        'SELECT id FROM path_history WHERE path = ? ORDER BY id ASC LIMIT 1',
        [remotePath],
      );
      if (row) {
        await tx.execute('DELETE FROM path_history WHERE path = ? AND id <> ?', [remotePath, row.id]);
        await tx.execute('UPDATE path_history SET timestamp = ? WHERE id = ?', [now, row.id]);
        await this.prune(tx, row.id);
        return row.id;
      }
      const inserted = await tx.execute('INSERT INTO path_history (path, timestamp) VALUES (?, ?)', [remotePath, now]);
      if (!inserted.lastInsertId) throw new Error('Path history insert did not return an id.');
      await this.prune(tx, inserted.lastInsertId);
      return inserted.lastInsertId;
    });
  }
  list(): Promise<PathHistoryEntry[]> {
    return this.db.queryAll(
      'SELECT id, path, timestamp FROM (SELECT id, path, timestamp FROM path_history ORDER BY timestamp DESC,id DESC LIMIT 2000) ORDER BY timestamp ASC,id ASC',
    );
  }
  private async prune(tx: Pick<RelationalDatabase, 'execute'>, touchedId: number): Promise<void> {
    await tx.execute(
      'DELETE FROM path_history WHERE id IN (SELECT id FROM path_history ORDER BY timestamp DESC,(id=?) DESC,id DESC LIMIT -1 OFFSET 2000)',
      [touchedId],
    );
  }
  async delete(id: number): Promise<boolean> {
    return (await this.db.execute('DELETE FROM path_history WHERE id = ?', [id])).changes > 0;
  }
  async clear(): Promise<number> {
    return (await this.db.execute('DELETE FROM path_history')).changes;
  }
}
