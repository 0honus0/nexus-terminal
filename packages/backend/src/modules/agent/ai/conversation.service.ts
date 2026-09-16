import { randomUUID } from 'node:crypto';
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

  async createThread(scope: Scope, title?: unknown): Promise<ThreadView> {
    const settings = await this.settings.get(scope.userId);
    if (!settings.effectiveSettings.feature.enabled) throw new Error('AGENT_DISABLED');
    const app = await this.lifecycle.get(scope);
    if (app.desiredState !== 'enabled' || !['running', 'degraded'].includes(app.observedState))
      throw new Error('AGENT_APP_DISABLED');
    const now = this.clock.nowUnixSeconds();
    const normalized = normalizeTitle(title);
    return this.repository.createThread(scope, randomUUID(), normalized.title, normalized.source, now);
  }

  async renameThread(scope: Scope, threadId: string, title: unknown, expectedVersion: unknown): Promise<ThreadView> {
    const normalized = normalizeTitle(title);
    if (normalized.source !== 'manual') throw new Error('VALIDATION_FAILED');
    return this.repository.renameThread(
      scope,
      threadId,
      normalized.title,
      normalizeExpectedVersion(expectedVersion),
      this.clock.nowUnixSeconds(),
    );
  }

  async getThread(scope: Scope, threadId: string): Promise<ThreadView> {
    const thread = await this.repository.getThread(scope, threadId);
    if (!thread) throw new Error('NOT_FOUND');
    return thread;
  }

  listThreads(scope: Scope, limit = 50, before?: string): Promise<ThreadPage> {
    return this.repository.listThreads(scope, validateLimit(limit, 100), before);
  }

  deleteThread(scope: Scope, threadId: string, expectedVersion: unknown): Promise<ThreadDeleteResult> {
    if (!threadId) throw new Error('VALIDATION_FAILED');
    return this.repository.deleteThread(
      scope,
      threadId,
      normalizeExpectedVersion(expectedVersion),
      this.clock.nowUnixSeconds(),
    );
  }

  deleteAllThreads(scope: Scope, confirmation: unknown): Promise<ThreadDeleteAllResult> {
    if (confirmation !== 'delete_all_threads') throw new Error('VALIDATION_FAILED');
    return this.repository.deleteAllThreads(scope, this.clock.nowUnixSeconds());
  }

  readPage(scope: Scope, threadId: string, limit = 50, before?: string): Promise<LedgerPage> {
    return this.repository.readEntries(scope, threadId, validateLimit(limit, 200), before);
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
