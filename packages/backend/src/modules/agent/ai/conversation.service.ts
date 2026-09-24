import { randomUUID } from 'node:crypto';
import { logger } from '../../../shared/logging/logger';
import type { ClockPort, JsonValue, Scope } from '../agent.types';
import { AgentSettingsService } from '../host/agent-settings.service';
import { AppLifecycleService } from '../host/app-lifecycle.service';
import type {
  ConversationRepositoryPort,
  LedgerEntryKind,
  LedgerEntryView,
  LedgerPage,
  ThreadPage,
  ThreadDeleteAllResult,
  ThreadDeleteResult,
  ThreadTitleSource,
  ThreadView,
} from './conversation.repository.port';
import type { ContextHistoryBoundary } from './context.types';
import { THREAD_PLACEHOLDER_TITLE } from './thread-title';
import { requireIdempotencyKey } from '../runtime/runs/idempotency';

const normalizeTitle = (title: unknown): { title: string; source: ThreadTitleSource } => {
  if (title === undefined || title === null || title === '') {
    return { title: THREAD_PLACEHOLDER_TITLE, source: 'placeholder' };
  }
  if (typeof title !== 'string') throw new Error('VALIDATION_FAILED');
  const normalized = title.trim();
  if (!normalized || normalized.length > 200) throw new Error('VALIDATION_FAILED');
  return { title: normalized, source: 'manual' };
};

const normalizeExpectedVersion = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('VALIDATION_FAILED');
  return Number(value);
};

const validateLimit = (limit: number, max: number): number => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) throw new Error('VALIDATION_FAILED');
  return limit;
};

export class ConversationService {
  constructor(
    private readonly repository: ConversationRepositoryPort,
    private readonly clock: ClockPort,
    private readonly settings: AgentSettingsService,
    private readonly lifecycle: AppLifecycleService,
  ) {}

  async createThread(scope: Scope, title?: unknown, idempotencyKey?: string): Promise<ThreadView> {
    const settings = await this.settings.get(scope.userId);
    if (!settings.effectiveSettings.feature.enabled) throw new Error('AGENT_DISABLED');
    const app = await this.lifecycle.get(scope);
    if (app.desiredState !== 'enabled' || !['running', 'degraded'].includes(app.observedState))
      throw new Error('AGENT_APP_DISABLED');
    const now = this.clock.nowUnixSeconds();
    const normalized = normalizeTitle(title);
    const threadId = idempotencyKey ? requireIdempotencyKey(idempotencyKey) : randomUUID();
    if (idempotencyKey) {
      const existing = await this.repository.getThread(scope, threadId);
      if (existing) {
        if (existing.title !== normalized.title || existing.titleSource !== normalized.source) {
          throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
        }
        return existing;
      }
    }
    const thread = await this.repository.createThread(scope, threadId, normalized.title, normalized.source, now);
    logger.info(
      {
        userId: scope.userId,
        appId: scope.appId,
        threadId: thread.id,
        titleSource: thread.titleSource,
        version: thread.version,
      },
      'Agent conversation thread created',
    );
    return thread;
  }

  async renameThread(scope: Scope, threadId: string, title: unknown, expectedVersion: unknown): Promise<ThreadView> {
    const normalized = normalizeTitle(title);
    if (normalized.source !== 'manual') throw new Error('VALIDATION_FAILED');
    const version = normalizeExpectedVersion(expectedVersion);
    const thread = await this.repository.renameThread(
      scope,
      threadId,
      normalized.title,
      version,
      this.clock.nowUnixSeconds(),
    );
    logger.info(
      { userId: scope.userId, appId: scope.appId, threadId, expectedVersion: version, version: thread.version },
      'Agent conversation thread renamed',
    );
    return thread;
  }

  async getThread(scope: Scope, threadId: string): Promise<ThreadView> {
    const thread = await this.repository.getThread(scope, threadId);
    if (!thread) throw new Error('NOT_FOUND');
    return thread;
  }

  listThreads(scope: Scope, limit = 50, before?: string): Promise<ThreadPage> {
    return this.repository.listThreads(scope, validateLimit(limit, 100), before);
  }

  async deleteThread(scope: Scope, threadId: string, expectedVersion: unknown): Promise<ThreadDeleteResult> {
    if (!threadId) throw new Error('VALIDATION_FAILED');
    const version = normalizeExpectedVersion(expectedVersion);
    const result = await this.repository.deleteThread(scope, threadId, version, this.clock.nowUnixSeconds());
    logger.info(
      { userId: scope.userId, appId: scope.appId, threadId, expectedVersion: version },
      'Agent conversation thread deleted',
    );
    return result;
  }

  async deleteAllThreads(scope: Scope, confirmation: unknown): Promise<ThreadDeleteAllResult> {
    if (confirmation !== 'delete_all_threads') throw new Error('VALIDATION_FAILED');
    const result = await this.repository.deleteAllThreads(scope, this.clock.nowUnixSeconds());
    logger.info(
      { userId: scope.userId, appId: scope.appId, deletedThreadCount: result.deletedCount },
      'Agent conversation threads deleted',
    );
    return result;
  }

  readPage(scope: Scope, threadId: string, limit = 50, before?: string): Promise<LedgerPage> {
    return this.repository.readEntries(scope, threadId, validateLimit(limit, 200), before);
  }

  readOldestPage(scope: Scope, threadId: string, limit = 4): Promise<LedgerPage> {
    return this.repository.readOldestEntries(scope, threadId, validateLimit(limit, 32));
  }

  searchEarlier(
    scope: Scope,
    threadId: string,
    queryTerms: readonly string[],
    beforeSequence: number,
    limit = 64,
  ): Promise<LedgerEntryView[]> {
    if (!Number.isSafeInteger(beforeSequence) || beforeSequence < 1 || queryTerms.length === 0) {
      throw new Error('VALIDATION_FAILED');
    }
    return this.repository.searchEarlierEntries(scope, threadId, queryTerms, beforeSequence, validateLimit(limit, 128));
  }

  readContextPage(
    scope: Scope,
    threadId: string,
    runId: string,
    historyBoundary: ContextHistoryBoundary,
    limit = 50,
  ): Promise<LedgerPage> {
    if (
      !Number.isSafeInteger(historyBoundary.baseThrough) ||
      historyBoundary.baseThrough < 0 ||
      Object.keys(historyBoundary.runThrough).length > 64 ||
      Object.entries(historyBoundary.runThrough).some(
        ([historyRunId, through]) => !historyRunId || !Number.isSafeInteger(through) || through < 0,
      )
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    return this.repository.readContextEntries(scope, threadId, runId, historyBoundary, validateLimit(limit, 200));
  }

  readVisibleThrough(
    scope: Scope,
    threadId: string,
    throughSequence: number,
    runId?: string,
    historyBoundary?: ContextHistoryBoundary,
  ): Promise<LedgerEntryView[]> {
    if (!Number.isSafeInteger(throughSequence) || throughSequence < 1) throw new Error('VALIDATION_FAILED');
    if ((historyBoundary === undefined) !== (runId === undefined)) {
      if (historyBoundary !== undefined || runId !== undefined) throw new Error('VALIDATION_FAILED');
    }
    return this.repository.readVisibleEntriesThrough(scope, threadId, throughSequence, runId, historyBoundary);
  }

  append(
    scope: Scope,
    threadId: string,
    kind: LedgerEntryKind,
    payload: JsonValue,
    runId?: string,
  ): Promise<LedgerEntryView> {
    return this.repository.appendEntry(scope, threadId, {
      id: randomUUID(),
      ...(runId ? { runId } : {}),
      kind,
      payload,
      createdAt: this.clock.nowUnixSeconds(),
    });
  }
}
