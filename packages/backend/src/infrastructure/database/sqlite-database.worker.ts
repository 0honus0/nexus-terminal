import fs from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import type {
  DatabaseWorkerData,
  DatabaseWorkerMetrics,
  DatabaseWorkerRequest,
  DatabaseWorkerResponse,
  SerializedDatabaseWorkerError,
} from './database-worker.protocol';
import { runMigrations } from './sqlite-migrations';
import { sqliteTableDefinitions } from './sqlite-schema.registry';
import { setBackendLogLevel } from '../../shared/logging/logger';

const STATEMENT_CACHE_LIMIT = 256;
const data = workerData as DatabaseWorkerData;
const port = parentPort;
if (!port) throw new Error('SQLite database worker requires a parent port.');

let database: DatabaseSync | null = null;
const statementCache = new Map<string, StatementSync>();

const toSqlParameters = (parameters: readonly unknown[]): SQLInputValue[] => parameters as SQLInputValue[];
const elapsedNs = (startedAt: bigint): number => Number(process.hrtime.bigint() - startedAt);

const serializeError = (error: unknown): SerializedDatabaseWorkerError => {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) };
  const withCode = error as Error & { code?: string | number };
  return {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(withCode.code !== undefined ? { code: withCode.code } : {}),
  };
};

const clearStatementCache = (): void => {
  statementCache.clear();
};

const firstSqlKeyword = (sql: string): string => {
  let remaining = sql;
  for (;;) {
    const next = remaining.replace(/^\s+/, '');
    if (next.startsWith('--')) {
      const newline = next.indexOf('\n');
      remaining = newline < 0 ? '' : next.slice(newline + 1);
      continue;
    }
    if (next.startsWith('/*')) {
      const end = next.indexOf('*/', 2);
      remaining = end < 0 ? '' : next.slice(end + 2);
      continue;
    }
    return /^[A-Za-z]+/.exec(next)?.[0]?.toUpperCase() ?? '';
  }
};

const mutatesSchema = (sql: string): boolean => {
  switch (firstSqlKeyword(sql)) {
    case 'ALTER':
    case 'ATTACH':
    case 'CREATE':
    case 'DETACH':
    case 'DROP':
    case 'PRAGMA':
    case 'REINDEX':
    case 'VACUUM':
      return true;
    default:
      return false;
  }
};

const configureDatabase = (db: DatabaseSync): void => {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
};

const openDatabase = async (): Promise<DatabaseSync> => {
  if (database) return database;
  fs.mkdirSync(data.dataDirectory, { recursive: true });
  const db = new DatabaseSync(data.databasePath);
  try {
    configureDatabase(db);
    for (const definition of sqliteTableDefinitions) db.exec(definition.sql);
    await runMigrations(db);
    clearStatementCache();
    database = db;
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
};

const closeDatabase = (): void => {
  clearStatementCache();
  database?.close();
  database = null;
};

const statement = (db: DatabaseSync, sql: string, metrics?: DatabaseWorkerMetrics): StatementSync => {
  const cached = statementCache.get(sql);
  if (cached) {
    statementCache.delete(sql);
    statementCache.set(sql, cached);
    return cached;
  }

  const startedAt = metrics ? process.hrtime.bigint() : 0n;
  const prepared = db.prepare(sql);
  if (metrics) metrics.prepareNs = elapsedNs(startedAt);
  statementCache.set(sql, prepared);
  if (statementCache.size > STATEMENT_CACHE_LIMIT) {
    const oldest = statementCache.keys().next().value as string | undefined;
    if (oldest !== undefined) statementCache.delete(oldest);
  }
  return prepared;
};

const isSchemaError = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'SQLITE_SCHEMA' || (error instanceof Error && error.message.includes('database schema has changed'));
};

const runStatement = <T>(
  db: DatabaseSync,
  sql: string,
  metrics: DatabaseWorkerMetrics | undefined,
  work: (prepared: StatementSync) => T,
): T => {
  try {
    return work(statement(db, sql, metrics));
  } catch (error) {
    if (!isSchemaError(error)) throw error;
    clearStatementCache();
    if (metrics) metrics.prepareNs = undefined;
    return work(statement(db, sql, metrics));
  }
};

const executeSql = async (
  type: 'execute' | 'queryOne' | 'queryAll',
  sql: string,
  parameters: readonly unknown[],
  metrics?: DatabaseWorkerMetrics,
): Promise<unknown> => {
  const db = await openDatabase();
  const startedAt = metrics ? process.hrtime.bigint() : 0n;
  try {
    const values = toSqlParameters(parameters);
    if (type === 'execute') {
      const result = runStatement(db, sql, metrics, (prepared) => prepared.run(...values));
      if (mutatesSchema(sql)) clearStatementCache();
      return { changes: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
    }
    if (type === 'queryOne') {
      const result = runStatement(db, sql, metrics, (prepared) => prepared.get(...values));
      return result ?? null;
    }
    return runStatement(db, sql, metrics, (prepared) => prepared.all(...values));
  } finally {
    if (metrics) metrics.executionNs = elapsedNs(startedAt);
  }
};

const executeTransactionControl = async (
  type: 'begin' | 'commit' | 'rollback',
  metrics?: DatabaseWorkerMetrics,
): Promise<void> => {
  const db = await openDatabase();
  const startedAt = metrics ? process.hrtime.bigint() : 0n;
  try {
    if (type === 'begin') db.exec('BEGIN IMMEDIATE');
    else if (type === 'commit') db.exec('COMMIT');
    else db.exec('ROLLBACK');
  } finally {
    if (metrics) metrics.executionNs = elapsedNs(startedAt);
  }
};

const resetDatabase = async (mode: 'seed' | 'empty', seedPath?: string): Promise<void> => {
  if (data.nodeEnv !== 'test' || !data.e2eResetEnabled) throw new Error('E2E database reset is disabled.');
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${data.databasePath}${suffix}`, { force: true });
  if (mode === 'seed') {
    if (!seedPath || !fs.existsSync(seedPath)) throw new Error(`E2E seed database not found: ${seedPath || '<unset>'}`);
    fs.copyFileSync(seedPath, data.databasePath);
  }
  await openDatabase();
};

const handle = async (request: DatabaseWorkerRequest): Promise<DatabaseWorkerResponse> => {
  let metrics: DatabaseWorkerMetrics | undefined =
    request.enqueuedAtNs && request.enqueuedAtNs > 0n ? { queueWaitNs: elapsedNs(request.enqueuedAtNs) } : undefined;
  try {
    switch (request.type) {
      case 'initialize':
        if (request.logLevel) setBackendLogLevel(request.logLevel);
        await openDatabase();
        return { id: request.id, ok: true };
      case 'execute':
      case 'queryOne':
      case 'queryAll': {
        const operationMetrics = request.measureOperation ? (metrics = { ...metrics, kind: request.type }) : undefined;
        const value = await executeSql(request.type, request.sql, request.parameters, operationMetrics);
        return { id: request.id, ok: true, value, ...(metrics ? { metrics } : {}) };
      }
      case 'begin':
      case 'commit':
      case 'rollback': {
        const operationMetrics = request.measureOperation ? (metrics = { ...metrics, kind: 'transaction' }) : undefined;
        await executeTransactionControl(request.type, operationMetrics);
        return { id: request.id, ok: true, ...(metrics ? { metrics } : {}) };
      }
      case 'reset':
        if (request.logLevel) setBackendLogLevel(request.logLevel);
        await resetDatabase(request.mode, request.seedPath);
        return { id: request.id, ok: true };
      case 'close':
        closeDatabase();
        return { id: request.id, ok: true };
    }
  } catch (error) {
    return { id: request.id, ok: false, error: serializeError(error), ...(metrics ? { metrics } : {}) };
  }
};

let requestTail: Promise<void> = Promise.resolve();
port.on('message', (request: DatabaseWorkerRequest) => {
  const processRequest = async () => {
    const response = await handle(request);
    try {
      port.postMessage(response);
    } catch (error) {
      port.postMessage({
        id: request.id,
        ok: false,
        error: serializeError(error),
        ...(response.metrics ? { metrics: response.metrics } : {}),
      } satisfies DatabaseWorkerResponse);
    }
  };
  requestTail = requestTail.then(processRequest, processRequest);
});
