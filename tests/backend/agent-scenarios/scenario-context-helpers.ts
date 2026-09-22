import assert from 'node:assert/strict';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { ContextCheckpointService } from '../../../packages/backend/src/modules/agent/ai/context-checkpoint.service';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import type {
  AppendLedgerEntry,
  ConversationRepositoryPort,
  LedgerEntryView,
  LedgerPage,
  ThreadDeleteAllResult,
  ThreadDeleteResult,
  ThreadPage,
  ThreadTitleSource,
  ThreadView,
} from '../../../packages/backend/src/modules/agent/ai/conversation.repository.port';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import type {
  RecallCandidate,
  RecallRepositoryPort,
} from '../../../packages/backend/src/modules/agent/ai/recall.repository.port';
import { SkillRegistry } from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import type {
  ContextCheckpointRepositoryPort,
  ContextCheckpointView,
  UpsertContextCheckpointRecord,
} from '../../../packages/backend/src/modules/agent/ai/context-checkpoint.repository.port';
import type { ContextHistoryBoundary } from '../../../packages/backend/src/modules/agent/ai/context.types';
import { clock, emptyModelContinuations } from './scenario-fixtures';

export class StaticConversationRepository implements ConversationRepositoryPort {
  constructor(private readonly entries: LedgerEntryView[]) {}

  async createThread(
    _scope: Scope,
    _id: string,
    _title: string,
    _titleSource: ThreadTitleSource,
    _now: number,
  ): Promise<ThreadView> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async renameThread(
    _scope: Scope,
    _threadId: string,
    _title: string,
    _expectedVersion: number,
    _now: number,
  ): Promise<ThreadView> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async getThread(_scope: Scope, _threadId: string): Promise<ThreadView | null> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async listThreads(_scope: Scope, _limit: number, _before?: string): Promise<ThreadPage> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async deleteThread(
    _scope: Scope,
    _threadId: string,
    _expectedVersion: number,
    _now: number,
  ): Promise<ThreadDeleteResult> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async deleteAllThreads(_scope: Scope, _now: number): Promise<ThreadDeleteAllResult> {
    throw new Error('SCENARIO_UNSUPPORTED');
  }

  async readEntries(_scope: Scope, _threadId: string, limit: number, _before?: string): Promise<LedgerPage> {
    const items = this.entries.slice(-limit);
    return { items, nextCursor: this.entries.length > limit ? `before:${items.at(0)?.sequence ?? 0}` : null };
  }

  async readOldestEntries(_scope: Scope, _threadId: string, limit: number): Promise<LedgerPage> {
    return { items: this.entries.slice(0, limit), nextCursor: null };
  }

  async searchEarlierEntries(
    _scope: Scope,
    _threadId: string,
    queryTerms: readonly string[],
    beforeSequence: number,
    limit: number,
  ): Promise<LedgerEntryView[]> {
    const normalizedTerms = queryTerms.map((term) => term.toLowerCase());
    return this.entries
      .filter(
        (item) =>
          item.sequence < beforeSequence &&
          ['user_input', 'assistant_message'].includes(item.kind) &&
          normalizedTerms.some((term) => JSON.stringify(item.payload).toLowerCase().includes(term)),
      )
      .slice(-limit);
  }

  async readContextEntries(
    _scope: Scope,
    _threadId: string,
    runId: string,
    historyBoundary: ContextHistoryBoundary,
    limit: number,
  ): Promise<LedgerPage> {
    const visible = this.entries.filter((item) => {
      if (item.sequence <= historyBoundary.baseThrough || item.runId === runId) return true;
      if (!item.runId) return false;
      const runThrough = historyBoundary.runThrough[item.runId];
      return runThrough !== undefined && item.sequence <= runThrough;
    });
    const items = visible.slice(-limit);
    return { items, nextCursor: visible.length > limit ? `before:${items.at(0)?.sequence ?? 0}` : null };
  }

  async readVisibleEntriesThrough(
    _scope: Scope,
    _threadId: string,
    throughSequence: number,
    runId?: string,
    historyBoundary?: ContextHistoryBoundary,
  ): Promise<LedgerEntryView[]> {
    return this.entries.filter((item) => {
      if (item.sequence > throughSequence) return false;
      if (!historyBoundary) return true;
      if (!runId) return false;
      if (item.sequence <= historyBoundary.baseThrough || item.runId === runId) return true;
      if (!item.runId) return false;
      const runThrough = historyBoundary.runThrough[item.runId];
      return runThrough !== undefined && item.sequence <= runThrough;
    });
  }

  async appendEntry(_scope: Scope, threadId: string, item: AppendLedgerEntry): Promise<LedgerEntryView> {
    const sequence = (this.entries.at(-1)?.sequence ?? 0) + 1;
    const entry: LedgerEntryView = {
      id: item.id,
      threadId,
      runId: item.runId ?? null,
      sequence,
      kind: item.kind,
      payload: item.payload,
      createdAt: item.createdAt,
    };
    this.entries.push(entry);
    return entry;
  }
}

export class StaticContextCheckpointRepository implements ContextCheckpointRepositoryPort {
  private readonly rows = new Map<string, ContextCheckpointView>();

  private key(
    threadId: string,
    visibilityHash: string,
    fromSequence: number,
    toSequence: number,
    strategyVersion: string,
  ): string {
    return [threadId, visibilityHash, fromSequence, toSequence, strategyVersion].join('\u0000');
  }

  async getExact(
    _scope: Scope,
    threadId: string,
    visibilityHash: string,
    fromSequence: number,
    toSequence: number,
    strategyVersion: string,
  ): Promise<ContextCheckpointView | null> {
    return this.rows.get(this.key(threadId, visibilityHash, fromSequence, toSequence, strategyVersion)) ?? null;
  }

  async upsert(record: UpsertContextCheckpointRecord): Promise<ContextCheckpointView> {
    const key = this.key(
      record.threadId,
      record.visibilityHash,
      record.fromSequence,
      record.toSequence,
      record.strategyVersion,
    );
    const previous = this.rows.get(key);
    const view: ContextCheckpointView = {
      id: previous?.id ?? record.id,
      threadId: record.threadId,
      visibilityHash: record.visibilityHash,
      visibility: record.visibility,
      fromSequence: record.fromSequence,
      toSequence: record.toSequence,
      sourceHash: record.sourceHash,
      strategyVersion: record.strategyVersion,
      generator: record.generator,
      sourceTokens: record.sourceTokens,
      summaryTokens: record.summaryTokens,
      content: record.content,
      createdAt: record.createdAt,
    };
    this.rows.set(key, view);
    return view;
  }
}

export class EmptyRecallRepository implements RecallRepositoryPort {
  async searchPublishedCandidates(
    _scope: Scope,
    _now: number,
    _queryTerms: readonly string[],
    _candidateLimit: number,
  ): Promise<RecallCandidate[]> {
    return [];
  }
}

export const entry = (
  sequence: number,
  kind: LedgerEntryView['kind'],
  payload: LedgerEntryView['payload'],
  runId: string | null = 'scenario-run',
): LedgerEntryView => ({
  id: `entry-${sequence}`,
  threadId: 'scenario-thread',
  runId,
  sequence,
  kind,
  payload,
  createdAt: 1_800_000_000 + sequence,
});

export const contextService = (entries: LedgerEntryView[]): ContextService => {
  const repository = new StaticConversationRepository(entries);
  // These collaborators are used only by mutation/thread-creation paths; scenarios below exercise real read projection.
  const conversations = new ConversationService(repository, clock, null!, null!);
  const recall = new RecallService(new EmptyRecallRepository(), clock);
  const checkpoints = new ContextCheckpointService(new StaticContextCheckpointRepository(), conversations, clock);
  return new ContextService(conversations, recall, new SkillRegistry(), emptyModelContinuations, null!, checkpoints);
};

export const assertValidToolExchange = (messages: Awaited<ReturnType<ContextService['compose']>>['messages']): void => {
  const visibleCalls = new Map<string, number>();
  const resultIds = new Set<string>();
  messages.forEach((message, index) => {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) visibleCalls.set(call.id, index);
    }
    if (message.role === 'tool' && message.toolCallId) {
      const assistantIndex = visibleCalls.get(message.toolCallId);
      assert.notEqual(assistantIndex, undefined, `orphan tool result ${message.toolCallId}`);
      assert.ok(assistantIndex! < index, `tool result ${message.toolCallId} must follow its assistant call`);
      resultIds.add(message.toolCallId);
    }
  });
  for (const callId of visibleCalls.keys()) {
    assert.ok(resultIds.has(callId), `assistant tool call ${callId} must retain its terminal result`);
  }
};
