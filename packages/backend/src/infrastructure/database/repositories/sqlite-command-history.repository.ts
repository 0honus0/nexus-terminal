import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type {
  CommandHistoryEntry,
  CommandHistoryRepository,
} from '../../../modules/command-history/command-history.repository.port';
export class SqliteCommandHistoryRepository implements CommandHistoryRepository {
  constructor(private readonly db: RelationalDatabase) {}
  async upsert(command: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const now = Math.floor(Date.now() / 1000);
      const row = await tx.queryOne<{ id: number }>(
        'SELECT id FROM command_history WHERE command = ? ORDER BY id ASC LIMIT 1',
        [command],
      );
      if (row) {
        await tx.execute('DELETE FROM command_history WHERE command = ? AND id <> ?', [command, row.id]);
        await tx.execute('UPDATE command_history SET timestamp = ? WHERE id = ?', [now, row.id]);
        return row.id;
      }
      const inserted = await tx.execute('INSERT INTO command_history (command, timestamp) VALUES (?, ?)', [
        command,
        now,
      ]);
      if (!inserted.lastInsertId) throw new Error('Command history insert did not return an id.');
      return inserted.lastInsertId;
    });
  }
  list(): Promise<CommandHistoryEntry[]> {
    return this.db.queryAll('SELECT id, command, timestamp FROM command_history ORDER BY timestamp ASC');
  }
  async delete(id: number): Promise<boolean> {
    return (await this.db.execute('DELETE FROM command_history WHERE id = ?', [id])).changes > 0;
  }
  async clear(): Promise<number> {
    return (await this.db.execute('DELETE FROM command_history')).changes;
  }
}
