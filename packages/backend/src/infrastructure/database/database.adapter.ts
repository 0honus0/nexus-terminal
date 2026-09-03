import type { RelationalDatabase, SqlStatementResult } from '../../platform/storage/relational-database.port';

/** SQLite implementation is migrated behind this adapter after the skeleton gate. */
export class DatabaseAdapter implements RelationalDatabase {
  private notMigrated(): Error {
    return new Error('Database adapter has not been migrated yet.');
  }

  execute(_sql: string, _parameters?: readonly unknown[]): Promise<SqlStatementResult> {
    return Promise.reject(this.notMigrated());
  }

  queryOne<TRow>(_sql: string, _parameters?: readonly unknown[]): Promise<TRow | null> {
    return Promise.reject(this.notMigrated());
  }

  queryAll<TRow>(_sql: string, _parameters?: readonly unknown[]): Promise<TRow[]> {
    return Promise.reject(this.notMigrated());
  }

  transaction<T>(_work: (database: RelationalDatabase) => Promise<T>): Promise<T> {
    return Promise.reject(this.notMigrated());
  }

  async close(): Promise<void> {}
}
