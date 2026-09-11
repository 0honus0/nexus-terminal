import type { JsonValue, Scope } from '../agent.types';
import type { ContextHistoryBoundary } from './context.types';

export type LedgerEntryKind = 'user_input' | 'assistant_message' | 'tool_result' | 'system_notice';

export interface ThreadView {
  id: string;
  appId: string;
  title: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  latestRunId: string | null;
}

export interface LedgerEntryView {
  id: string;
  threadId: string;
  runId: string | null;
  sequence: number;
  kind: LedgerEntryKind;
  payload: JsonValue;
  createdAt: number;
}

export interface ThreadPage {
  items: ThreadView[];
  nextCursor: string | null;
}

export interface LedgerPage {
  items: LedgerEntryView[];
  nextCursor: string | null;
}

export interface AppendLedgerEntry {
  id: string;
  runId?: string;
  kind: LedgerEntryKind;
  payload: JsonValue;
  createdAt: number;
}

export interface ConversationRepositoryPort {
  createThread(scope: Scope, id: string, title: string, now: number): Promise<ThreadView>;
  getThread(scope: Scope, threadId: string): Promise<ThreadView | null>;
  listThreads(scope: Scope, limit: number, before?: string): Promise<ThreadPage>;
  readEntries(scope: Scope, threadId: string, limit: number, before?: string): Promise<LedgerPage>;
  readContextEntries(
    scope: Scope,
    threadId: string,
    runId: string,
    historyBoundary: ContextHistoryBoundary,
    limit: number,
  ): Promise<LedgerPage>;
  appendEntry(scope: Scope, threadId: string, entry: AppendLedgerEntry): Promise<LedgerEntryView>;
}

export type { JsonValue, Scope } from '../agent.types';
