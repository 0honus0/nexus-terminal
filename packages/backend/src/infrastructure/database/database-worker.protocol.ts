import type { DatabaseOperationKind } from '../../shared/observability/runtime-performance';
import type { LogLevel } from '../../shared/logging/log-level';

export type DatabaseWorkerRequest = (
  | { id: number; type: 'initialize'; logLevel?: LogLevel }
  | { id: number; type: 'execute'; sql: string; parameters: readonly unknown[] }
  | { id: number; type: 'queryOne'; sql: string; parameters: readonly unknown[] }
  | { id: number; type: 'queryAll'; sql: string; parameters: readonly unknown[] }
  | { id: number; type: 'begin' }
  | { id: number; type: 'commit' }
  | { id: number; type: 'rollback' }
  | { id: number; type: 'reset'; mode: 'seed' | 'empty'; seedPath?: string; logLevel?: LogLevel }
  | { id: number; type: 'close' }
) & { enqueuedAtNs?: bigint; measureOperation?: boolean };

export interface DatabaseWorkerMetrics {
  kind?: DatabaseOperationKind;
  executionNs?: number;
  prepareNs?: number;
  queueWaitNs?: number;
}

export interface SerializedDatabaseWorkerError {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
}

export type DatabaseWorkerResponse =
  | { id: number; ok: true; value?: unknown; metrics?: DatabaseWorkerMetrics }
  | { id: number; ok: false; error: SerializedDatabaseWorkerError; metrics?: DatabaseWorkerMetrics };

export interface DatabaseWorkerData {
  databasePath: string;
  dataDirectory: string;
  nodeEnv?: string;
  e2eResetEnabled?: boolean;
}
