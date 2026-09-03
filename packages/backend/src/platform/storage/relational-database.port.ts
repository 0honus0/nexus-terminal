export interface SqlStatementResult {
  changes: number;
  lastInsertId?: number;
}

export interface RelationalDatabase {
  execute(sql: string, parameters?: readonly unknown[]): Promise<SqlStatementResult>;
  queryOne<TRow>(sql: string, parameters?: readonly unknown[]): Promise<TRow | null>;
  queryAll<TRow>(sql: string, parameters?: readonly unknown[]): Promise<TRow[]>;
  transaction<T>(work: (database: RelationalDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
