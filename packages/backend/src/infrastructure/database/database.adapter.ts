import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { RelationalDatabase, SqlStatementResult } from '../../platform/storage/relational-database.port';
import { runtimePerformanceMetrics } from '../../shared/observability/runtime-performance';
import { getBackendLogLevel, logger } from '../../shared/logging/logger';
import type {
  DatabaseWorkerData,
  DatabaseWorkerMetrics,
  DatabaseWorkerRequest,
  DatabaseWorkerResponse,
  SerializedDatabaseWorkerError,
} from './database-worker.protocol';

export type E2EDatabaseResetMode = 'seed' | 'empty';

export interface DatabaseAdapterOptions {
  dataDirectory: string;
  filename?: string;
  nodeEnv?: string;
  e2eResetEnabled?: boolean;
}

type PendingWorkerRequest = {
  resolve: (response: DatabaseWorkerResponse) => void;
  reject: (error: Error) => void;
};

type DatabaseQueueToken = {
  enqueuedAt: bigint;
  completed: boolean;
};

type ScheduledDatabaseOperation = {
  mode: 'shared' | 'exclusive';
  run: () => void;
};

type WithoutId<T> = T extends { id: number } ? Omit<T, 'id'> : never;
type WorkerRequestPayload = WithoutId<DatabaseWorkerRequest>;

const WORKER_BOOTSTRAP = `
const { workerData } = require('node:worker_threads');
if (workerData.tsxApiPath) {
  require(workerData.tsxApiPath).require(workerData.entryPath, __filename);
} else {
  require(workerData.entryPath);
}
`;

const fromSerializedError = (error: SerializedDatabaseWorkerError): Error => {
  const restored = new Error(error.message);
  restored.name = error.name;
  if (error.stack) restored.stack = error.stack;
  if (error.code !== undefined) (restored as Error & { code?: string | number }).code = error.code;
  return restored;
};

const ns = (value: number | undefined): bigint => BigInt(Math.max(1, Math.round(value ?? 1)));

class TransactionDatabase implements RelationalDatabase {
  constructor(private readonly request: <T>(payload: WorkerRequestPayload) => Promise<T>) {}

  execute(sql: string, parameters: readonly unknown[] = []): Promise<SqlStatementResult> {
    return this.request<SqlStatementResult>({ type: 'execute', sql, parameters });
  }

  queryOne<TRow>(sql: string, parameters: readonly unknown[] = []): Promise<TRow | null> {
    return this.request<TRow | null>({ type: 'queryOne', sql, parameters });
  }

  queryAll<TRow>(sql: string, parameters: readonly unknown[] = []): Promise<TRow[]> {
    return this.request<TRow[]>({ type: 'queryAll', sql, parameters });
  }

  async transaction<T>(_work: (database: RelationalDatabase) => Promise<T>): Promise<T> {
    throw new Error('Nested database transactions are not supported.');
  }

  async close(): Promise<void> {
    throw new Error('A transaction-scoped database cannot close the shared connection.');
  }
}

/**
 * Single-owner SQLite adapter backed by one Worker Thread. Ordinary operations can be in flight
 * concurrently to avoid main-thread RPC head-of-line blocking; the Worker executes them FIFO.
 * Transactions and lifecycle operations use an exclusive scheduler barrier so nothing can
 * interleave between BEGIN and COMMIT/ROLLBACK.
 */
export class DatabaseAdapter implements RelationalDatabase {
  private readonly operationQueue: ScheduledDatabaseOperation[] = [];
  private activeSharedOperations = 0;
  private exclusiveOperationActive = false;
  private readonly databasePath: string;
  private worker: Worker | null = null;
  private workerInitialization: Promise<void> | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingWorkerRequest>();
  private expectedWorkerExit = false;

  constructor(private readonly options: DatabaseAdapterOptions) {
    this.databasePath = path.join(options.dataDirectory, options.filename ?? 'nexus-terminal.db');
  }

  get filePath(): string {
    return this.databasePath;
  }

  async initialize(): Promise<void> {
    await this.scheduleExclusive(async (queueToken) => {
      this.finishQueueToken(queueToken);
      await this.ensureInitialized();
    });
  }

  execute(sql: string, parameters: readonly unknown[] = []): Promise<SqlStatementResult> {
    return this.scheduleShared(async (queueToken) => {
      await this.ensureInitialized();
      return this.requestOperation<SqlStatementResult>({ type: 'execute', sql, parameters }, queueToken);
    });
  }

  queryOne<TRow>(sql: string, parameters: readonly unknown[] = []): Promise<TRow | null> {
    return this.scheduleShared(async (queueToken) => {
      await this.ensureInitialized();
      return this.requestOperation<TRow | null>({ type: 'queryOne', sql, parameters }, queueToken);
    });
  }

  queryAll<TRow>(sql: string, parameters: readonly unknown[] = []): Promise<TRow[]> {
    return this.scheduleShared(async (queueToken) => {
      await this.ensureInitialized();
      return this.requestOperation<TRow[]>({ type: 'queryAll', sql, parameters }, queueToken);
    });
  }

  transaction<T>(work: (database: RelationalDatabase) => Promise<T>): Promise<T> {
    return this.scheduleExclusive(async (queueToken) => {
      await this.ensureInitialized();
      await this.requestOperation<void>({ type: 'begin' }, queueToken);
      const transactionDatabase = new TransactionDatabase((payload) => this.requestOperation(payload));
      try {
        const result = await work(transactionDatabase);
        await this.requestOperation<void>({ type: 'commit' });
        return result;
      } catch (error) {
        try {
          await this.requestOperation<void>({ type: 'rollback' });
        } catch {
          // Preserve the original transaction error.
        }
        throw error;
      }
    });
  }

  close(): Promise<void> {
    return this.scheduleExclusive(async (queueToken) => {
      this.finishQueueToken(queueToken);
      const worker = this.worker;
      if (!worker) return;
      try {
        if (this.workerInitialization) await this.workerInitialization;
        await this.requestRaw<void>({ type: 'close' });
      } finally {
        this.expectedWorkerExit = true;
        this.worker = null;
        this.workerInitialization = null;
        await worker.terminate();
        this.expectedWorkerExit = false;
        this.rejectPending(new Error('SQLite database worker was closed.'));
      }
    });
  }

  resetForE2E(mode: E2EDatabaseResetMode, seedPath?: string): Promise<void> {
    if (this.options.nodeEnv !== 'test' || !this.options.e2eResetEnabled) {
      return Promise.reject(new Error('E2E database reset is disabled.'));
    }
    return this.scheduleExclusive(async (queueToken) => {
      this.finishQueueToken(queueToken);
      await this.ensureInitialized();
      await this.requestRaw<void>({
        type: 'reset',
        mode,
        ...(seedPath ? { seedPath } : {}),
        logLevel: getBackendLogLevel(),
      });
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.workerInitialization) return this.workerInitialization;
    this.spawnWorker();
    this.workerInitialization = this.requestRaw<void>({ type: 'initialize', logLevel: getBackendLogLevel() }).catch(
      (error) => {
        this.workerInitialization = null;
        throw error;
      },
    );
    return this.workerInitialization;
  }

  private spawnWorker(): void {
    if (this.worker) return;
    const runningSource = path.extname(__filename) === '.ts';
    const entryPath = path.join(__dirname, `sqlite-database.worker.${runningSource ? 'ts' : 'js'}`);
    const workerData: DatabaseWorkerData & { entryPath: string; tsxApiPath?: string } = {
      databasePath: this.databasePath,
      dataDirectory: this.options.dataDirectory,
      nodeEnv: this.options.nodeEnv,
      e2eResetEnabled: this.options.e2eResetEnabled,
      entryPath,
      ...(runningSource ? { tsxApiPath: require.resolve('tsx/cjs/api') } : {}),
    };
    const worker = new Worker(WORKER_BOOTSTRAP, { eval: true, workerData });
    this.worker = worker;
    logger.debug({ sourceMode: runningSource ? 'typescript' : 'javascript' }, 'SQLite database worker started');
    worker.on('message', (response: DatabaseWorkerResponse) => this.handleResponse(response));
    worker.on('error', (error: Error) => {
      if (this.worker !== worker) return;
      logger.error({ err: error, pendingRequests: this.pending.size }, 'SQLite database worker error');
      this.worker = null;
      this.workerInitialization = null;
      this.rejectPending(error);
    });
    worker.on('exit', (code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.workerInitialization = null;
      if (!this.expectedWorkerExit) {
        const error = new Error(`SQLite database worker exited unexpectedly with code ${code}.`);
        logger.error(
          { err: error, exitCode: code, pendingRequests: this.pending.size },
          'SQLite database worker exited',
        );
        this.rejectPending(error);
      }
    });
  }

  private requestOperation<T>(payload: WorkerRequestPayload, queueToken?: DatabaseQueueToken): Promise<T> {
    return this.requestRaw<T>(payload, true, queueToken);
  }

  private requestRaw<T>(
    payload: WorkerRequestPayload,
    recordMetrics = false,
    queueToken?: DatabaseQueueToken,
  ): Promise<T> {
    const worker = this.worker;
    if (!worker) {
      if (queueToken) this.finishQueueToken(queueToken);
      return Promise.reject(new Error('SQLite database worker is not running.'));
    }
    const id = this.nextRequestId++;
    const metricsStartedAt = recordMetrics ? runtimePerformanceMetrics.operationStarted() : 0n;
    return new Promise<T>((resolve, reject) => {
      const rejectRequest = (error: Error) => {
        if (queueToken) this.finishQueueToken(queueToken);
        reject(error);
      };
      this.pending.set(id, {
        resolve: (response) => {
          if (queueToken) this.finishQueueToken(queueToken, response.metrics?.queueWaitNs);
          if (recordMetrics && response.metrics) this.recordWorkerMetrics(response.metrics, metricsStartedAt);
          if (response.ok) resolve(response.value as T);
          else reject(fromSerializedError(response.error));
        },
        reject: rejectRequest,
      });
      try {
        worker.postMessage({
          ...payload,
          id,
          ...(queueToken?.enqueuedAt ? { enqueuedAtNs: queueToken.enqueuedAt } : {}),
          ...(metricsStartedAt !== 0n ? { measureOperation: true } : {}),
        } as DatabaseWorkerRequest);
      } catch (error) {
        this.pending.delete(id);
        const cause = error instanceof Error ? error : new Error(String(error));
        logger.error({ err: cause, databaseOperation: payload.type }, 'Unable to dispatch SQLite worker request');
        rejectRequest(cause);
      }
    });
  }

  private handleResponse(response: DatabaseWorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private recordWorkerMetrics(metrics: DatabaseWorkerMetrics, startedAt: bigint): void {
    if (metrics.prepareNs !== undefined) {
      runtimePerformanceMetrics.recordDatabasePrepare(ns(metrics.prepareNs), startedAt);
    }
    if (metrics.kind && metrics.executionNs !== undefined) {
      runtimePerformanceMetrics.recordDatabaseExecution(metrics.kind, ns(metrics.executionNs), startedAt);
    }
  }

  private finishQueueToken(queueToken: DatabaseQueueToken, queueWaitNs?: number): void {
    if (queueToken.completed) return;
    queueToken.completed = true;
    runtimePerformanceMetrics.databaseStarted(
      queueToken.enqueuedAt,
      queueWaitNs === undefined ? undefined : ns(queueWaitNs),
    );
  }

  private scheduleShared<T>(work: (queueToken: DatabaseQueueToken) => Promise<T>): Promise<T> {
    return this.schedule('shared', work);
  }

  private scheduleExclusive<T>(work: (queueToken: DatabaseQueueToken) => Promise<T>): Promise<T> {
    return this.schedule('exclusive', work);
  }

  private schedule<T>(
    mode: ScheduledDatabaseOperation['mode'],
    work: (queueToken: DatabaseQueueToken) => Promise<T>,
  ): Promise<T> {
    const queueToken: DatabaseQueueToken = {
      enqueuedAt: runtimePerformanceMetrics.databaseEnqueued(),
      completed: false,
    };
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        if (mode === 'shared') this.activeSharedOperations += 1;
        else this.exclusiveOperationActive = true;

        void work(queueToken)
          .then(resolve, reject)
          .finally(() => {
            this.finishQueueToken(queueToken);
            if (mode === 'shared') this.activeSharedOperations = Math.max(0, this.activeSharedOperations - 1);
            else this.exclusiveOperationActive = false;
            this.drainOperationQueue();
          });
      };
      const queuedBehindBarrier =
        this.exclusiveOperationActive ||
        this.operationQueue.length > 0 ||
        (mode === 'exclusive' && this.activeSharedOperations > 0);
      this.operationQueue.push({ mode, run });
      if (queuedBehindBarrier) {
        logger.trace(
          {
            mode,
            queuedOperations: this.operationQueue.length,
            activeSharedOperations: this.activeSharedOperations,
            exclusiveOperationActive: this.exclusiveOperationActive,
          },
          'SQLite operation queued behind scheduler barrier',
        );
      }
      this.drainOperationQueue();
    });
  }

  private drainOperationQueue(): void {
    if (this.exclusiveOperationActive) return;
    while (this.operationQueue.length > 0) {
      const next = this.operationQueue[0]!;
      if (next.mode === 'exclusive') {
        if (this.activeSharedOperations > 0) return;
        this.operationQueue.shift();
        next.run();
        return;
      }
      this.operationQueue.shift();
      next.run();
    }
  }
}
