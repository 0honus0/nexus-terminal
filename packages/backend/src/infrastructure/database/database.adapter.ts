import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { RelationalDatabase, SqlStatementResult } from '../../platform/storage/relational-database.port';
import { runMigrations } from './sqlite-migrations';
import { sqliteTableDefinitions } from './sqlite-schema.registry';

export type E2EDatabaseResetMode = 'seed' | 'empty';

export interface DatabaseAdapterOptions {
  dataDirectory: string;
  filename?: string;
  nodeEnv?: string;
  e2eResetEnabled?: boolean;
}

class TransactionDatabase implements RelationalDatabase {
  constructor(private readonly database: DatabaseSync) {}

  async execute(sql: string, parameters: readonly unknown[] = []): Promise<SqlStatementResult> {
    const result = this.database.prepare(sql).run(...toSqlParameters(parameters));
    return { changes: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
  }

  async queryOne<TRow>(sql: string, parameters: readonly unknown[] = []): Promise<TRow | null> {
    return (this.database.prepare(sql).get(...toSqlParameters(parameters)) as TRow | undefined) ?? null;
  }

  async queryAll<TRow>(sql: string, parameters: readonly unknown[] = []): Promise<TRow[]> {
    return this.database.prepare(sql).all(...toSqlParameters(parameters)) as TRow[];
  }

  async transaction<T>(_work: (database: RelationalDatabase) => Promise<T>): Promise<T> {
    throw new Error('Nested database transactions are not supported.');
  }

  async close(): Promise<void> {
    throw new Error('A transaction-scoped database cannot close the shared connection.');
  }
}

const toSqlParameters = (parameters: readonly unknown[]): SQLInputValue[] => parameters as SQLInputValue[];

/**
 * Single-owner SQLite adapter. All public operations are serialized because node:sqlite is synchronous;
 * transaction callbacks receive a transaction-scoped port so no external operation can interleave.
 */
export class DatabaseAdapter implements RelationalDatabase {
  private database: DatabaseSync | null = null;
  private openPromise: Promise<DatabaseSync> | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private readonly databasePath: string;

  constructor(private readonly options: DatabaseAdapterOptions) {
    this.databasePath = path.join(options.dataDirectory, options.filename ?? 'nexus-terminal.db');
  }

  get filePath(): string {
    return this.databasePath;
  }

  async initialize(): Promise<void> {
    await this.serialize(async () => {
      await this.open();
    });
  }

  execute(sql: string, parameters: readonly unknown[] = []): Promise<SqlStatementResult> {
    return this.serialize(async () => {
      const database = await this.open();
      const result = database.prepare(sql).run(...toSqlParameters(parameters));
      return { changes: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
    });
  }

  queryOne<TRow>(sql: string, parameters: readonly unknown[] = []): Promise<TRow | null> {
    return this.serialize(async () => {
      const database = await this.open();
      return (database.prepare(sql).get(...toSqlParameters(parameters)) as TRow | undefined) ?? null;
    });
  }

  queryAll<TRow>(sql: string, parameters: readonly unknown[] = []): Promise<TRow[]> {
    return this.serialize(async () => {
      const database = await this.open();
      return database.prepare(sql).all(...toSqlParameters(parameters)) as TRow[];
    });
  }

  transaction<T>(work: (database: RelationalDatabase) => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      const database = await this.open();
      database.exec('BEGIN IMMEDIATE');
      const transactionDatabase = new TransactionDatabase(database);
      try {
        const result = await work(transactionDatabase);
        database.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          database.exec('ROLLBACK');
        } catch {
          // Preserve the original transaction error.
        }
        throw error;
      }
    });
  }

  close(): Promise<void> {
    return this.serialize(async () => {
      const database = this.database;
      this.database = null;
      this.openPromise = null;
      database?.close();
    });
  }

  resetForE2E(mode: E2EDatabaseResetMode, seedPath?: string): Promise<void> {
    return this.serialize(async () => {
      if (this.options.nodeEnv !== 'test' || !this.options.e2eResetEnabled) {
        throw new Error('E2E database reset is disabled.');
      }

      this.database?.close();
      this.database = null;
      this.openPromise = null;

      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${this.databasePath}${suffix}`, { force: true });

      if (mode === 'seed') {
        if (!seedPath || !fs.existsSync(seedPath)) throw new Error(`E2E seed database not found: ${seedPath || '<unset>'}`);
        fs.copyFileSync(seedPath, this.databasePath);
      }

      await this.open();
    });
  }

  private async open(): Promise<DatabaseSync> {
    if (this.database) return this.database;
    if (this.openPromise) return this.openPromise;

    this.openPromise = (async () => {
      fs.mkdirSync(this.options.dataDirectory, { recursive: true });
      const database = new DatabaseSync(this.databasePath);
      try {
        database.exec('PRAGMA foreign_keys = ON;');
        for (const definition of sqliteTableDefinitions) database.exec(definition.sql);
        await runMigrations(database);
        this.database = database;
        return database;
      } catch (error) {
        database.close();
        throw error;
      } finally {
        this.openPromise = null;
      }
    })();

    return this.openPromise;
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(work, work);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}
