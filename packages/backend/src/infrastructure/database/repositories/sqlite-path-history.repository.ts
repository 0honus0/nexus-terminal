import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type {
  PathHistoryEntry,
  PathHistoryRepository,
} from '../../../modules/path-history/path-history.repository.port';
export class SqlitePathHistoryRepository implements PathHistoryRepository {
  constructor(private readonly db: RelationalDatabase) {}
  async upsert(remotePath: string): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const updated = await this.db.execute('UPDATE path_history SET timestamp = ? WHERE path = ?', [now, remotePath]);
    if (updated.changes) {
      const row = await this.db.queryOne<{ id: number }>(
        'SELECT id FROM path_history WHERE path = ? ORDER BY timestamp DESC LIMIT 1',
        [remotePath],
      );
      if (!row) throw new Error('Updated path history row could not be reloaded.');
      return row.id;
    }
    const inserted = await this.db.execute('INSERT INTO path_history (path, timestamp) VALUES (?, ?)', [
      remotePath,
      now,
    ]);
    if (!inserted.lastInsertId) throw new Error('Path history insert did not return an id.');
    return inserted.lastInsertId;
  }
  list(): Promise<PathHistoryEntry[]> {
    return this.db.queryAll('SELECT id, path, timestamp FROM path_history ORDER BY timestamp ASC');
  }
  async delete(id: number): Promise<boolean> {
    return (await this.db.execute('DELETE FROM path_history WHERE id = ?', [id])).changes > 0;
  }
  async clear(): Promise<number> {
    return (await this.db.execute('DELETE FROM path_history')).changes;
  }
}
