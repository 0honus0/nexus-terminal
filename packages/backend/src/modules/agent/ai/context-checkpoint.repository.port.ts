import type { Scope } from '../agent.types';
import type { ContextHistoryBoundary } from './context.types';

export type ContextCheckpointVisibility =
  { kind: 'thread_prefix' } | { kind: 'run_boundary'; runId: string; historyBoundary: ContextHistoryBoundary };

export interface ContextCheckpointGenerator {
  kind: 'deterministic';
  version: string;
}

export interface ContextCheckpointView {
  id: string;
  threadId: string;
  visibilityHash: string;
  visibility: ContextCheckpointVisibility;
  fromSequence: number;
  toSequence: number;
  sourceHash: string;
  strategyVersion: string;
  generator: ContextCheckpointGenerator;
  sourceTokens: number;
  summaryTokens: number;
  content: string;
  createdAt: number;
}

export interface UpsertContextCheckpointRecord {
  scope: Scope;
  id: string;
  threadId: string;
  visibilityHash: string;
  visibility: ContextCheckpointVisibility;
  fromSequence: number;
  toSequence: number;
  sourceHash: string;
  strategyVersion: string;
  generator: ContextCheckpointGenerator;
  sourceTokens: number;
  summaryTokens: number;
  content: string;
  createdAt: number;
}

export interface ContextCheckpointRepositoryPort {
  getExact(
    scope: Scope,
    threadId: string,
    visibilityHash: string,
    fromSequence: number,
    toSequence: number,
    strategyVersion: string,
  ): Promise<ContextCheckpointView | null>;
  upsert(record: UpsertContextCheckpointRecord): Promise<ContextCheckpointView>;
}
