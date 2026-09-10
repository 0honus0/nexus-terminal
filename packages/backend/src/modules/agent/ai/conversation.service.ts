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
  ThreadView,
} from './conversation.repository.port';

const normalizeTitle = (title: unknown): string => {
  if (title === undefined || title === null || title === '') return 'New conversation';
  if (typeof title !== 'string') throw new Error('VALIDATION_FAILED');
  const normalized = title.trim();
  if (!normalized || normalized.length > 200) throw new Error('VALIDATION_FAILED');
  return normalized;
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
    return this.repository.createThread(scope, randomUUID(), normalizeTitle(title), now);
  }

  async getThread(scope: Scope, threadId: string): Promise<ThreadView> {
    const thread = await this.repository.getThread(scope, threadId);
    if (!thread) throw new Error('NOT_FOUND');
    return thread;
  }

  listThreads(scope: Scope, limit = 50, before?: string): Promise<ThreadPage> {
    return this.repository.listThreads(scope, validateLimit(limit, 100), before);
  }

  readPage(scope: Scope, threadId: string, limit = 50, before?: string): Promise<LedgerPage> {
    return this.repository.readEntries(scope, threadId, validateLimit(limit, 200), before);
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
