import type { ClockPort, Scope } from '../../agent.types';
import type { AgentSettingsService } from '../../host/agent-settings.service';
import type { AgentBackendPort } from '../execution/agent-backend.port';
import { AgentEventHub } from '../events/event-hub';
import type { RunView } from '../runs/run.types';
import { logger } from '../../../../shared/logging/logger';

interface QueuedRun {
  run: RunView;
}

interface ScheduledRetry {
  run: RunView;
  timer: ReturnType<typeof setTimeout>;
}

const scopeKey = (scope: Scope): string => `${scope.userId}\u0000${scope.appId}`;
const RETRY_BASE_DELAY_MS = 100;
const RETRY_MAX_DELAY_MS = 5_000;

export class AgentScheduler {
  private readonly queues = new Map<string, QueuedRun[]>();
  private readonly appOrder: string[] = [];
  private readonly active = new Map<string, { run: RunView; controller: AbortController; done: Promise<void> }>();
  private readonly activeByUser = new Map<number, number>();
  private readonly pausedScopes = new Set<string>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly scheduledRetries = new Map<string, ScheduledRetry>();
  private appCursor = 0;
  private accepting = true;
  private pumping = false;

  constructor(
    private readonly settings: AgentSettingsService,
    private readonly backend: AgentBackendPort,
    private readonly events: AgentEventHub,
    private readonly clock: ClockPort,
    private readonly hostCursor: (userId: number) => Promise<number>,
    private readonly externalActiveCount: (userId: number) => number = () => 0,
    private readonly runBlocked: (runId: string) => boolean = () => false,
  ) {}

  enqueue(run: RunView): void {
    if (
      !this.accepting ||
      this.pausedScopes.has(scopeKey({ userId: run.userId, appId: run.appId })) ||
      !['created', 'running'].includes(run.status)
    )
      return;
    const active = this.active.get(run.id);
    if (active) {
      void active.done.finally(() => this.enqueue(run));
      return;
    }
    let queue = this.queues.get(run.appId);
    if (!queue) {
      queue = [];
      this.queues.set(run.appId, queue);
      this.appOrder.push(run.appId);
    }
    if (queue.some((candidate) => candidate.run.id === run.id)) return;
    queue.push({ run });
    logger.debug(
      {
        runId: run.id,
        threadId: run.threadId,
        appId: run.appId,
        userId: run.userId,
        status: run.status,
        queueDepth: queue.length,
        activeForUser: this.activeCountForUser(run.userId),
      },
      'Agent scheduler enqueued run',
    );
    this.requestPump();
  }

  signalInput(run: RunView, reason: 'NEW_INPUT' | 'GOAL_UPDATED' = 'NEW_INPUT'): boolean {
    const active = this.active.get(run.id);
    if (!active) return false;
    active.controller.abort(new Error(reason));
    void active.done.finally(() => this.enqueue(run));
    return true;
  }

  cancel(runId: string): boolean {
    const retry = this.scheduledRetries.get(runId);
    if (retry) {
      clearTimeout(retry.timer);
      this.scheduledRetries.delete(runId);
      this.retryAttempts.delete(runId);
      return true;
    }
    const active = this.active.get(runId);
    if (active) {
      active.controller.abort(new Error('CANCELLED'));
      return true;
    }
    for (const queue of this.queues.values()) {
      const index = queue.findIndex((candidate) => candidate.run.id === runId);
      if (index >= 0) {
        queue.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  async quiesce(deadlineUnixSeconds: number): Promise<void> {
    this.accepting = false;
    for (const retry of this.scheduledRetries.values()) clearTimeout(retry.timer);
    this.scheduledRetries.clear();
    this.retryAttempts.clear();
    this.queues.clear();
    this.appOrder.length = 0;
    for (const active of this.active.values()) active.controller.abort(new Error('AGENT_QUIESCE'));
    const remainingMs = Math.max(0, deadlineUnixSeconds * 1000 - this.clock.nowUnixMilliseconds());
    if (this.active.size === 0 || remainingMs === 0) return;
    await Promise.race([
      Promise.allSettled([...this.active.values()].map((active) => active.done)),
      new Promise<void>((resolve) => setTimeout(resolve, remainingMs)),
    ]);
    if (this.active.size > 0) throw new Error('APP_QUIESCE_TIMEOUT');
  }

  async quiesceScope(scope: Scope, deadlineUnixSeconds: number): Promise<void> {
    this.pausedScopes.add(scopeKey(scope));
    for (const [runId, retry] of this.scheduledRetries) {
      if (retry.run.userId !== scope.userId || retry.run.appId !== scope.appId) continue;
      clearTimeout(retry.timer);
      this.scheduledRetries.delete(runId);
      this.retryAttempts.delete(runId);
    }
    const queue = this.queues.get(scope.appId);
    if (queue) {
      const remaining = queue.filter((candidate) => candidate.run.userId !== scope.userId);
      if (remaining.length > 0) this.queues.set(scope.appId, remaining);
      else {
        this.queues.delete(scope.appId);
        const index = this.appOrder.indexOf(scope.appId);
        if (index >= 0) this.appOrder.splice(index, 1);
        if (this.appOrder.length === 0) this.appCursor = 0;
        else this.appCursor %= this.appOrder.length;
      }
    }

    const matching = [...this.active.values()].filter(
      (active) => active.run.userId === scope.userId && active.run.appId === scope.appId,
    );
    for (const active of matching) active.controller.abort(new Error('AGENT_QUIESCE'));
    const remainingMs = Math.max(0, deadlineUnixSeconds * 1000 - this.clock.nowUnixMilliseconds());
    if (matching.length === 0 || remainingMs === 0) return;
    await Promise.race([
      Promise.allSettled(matching.map((active) => active.done)),
      new Promise<void>((resolve) => setTimeout(resolve, remainingMs)),
    ]);
    if (
      [...this.active.values()].some((active) => active.run.userId === scope.userId && active.run.appId === scope.appId)
    ) {
      throw new Error('APP_QUIESCE_TIMEOUT');
    }
  }

  resumeScope(scope: Scope): void {
    this.pausedScopes.delete(scopeKey(scope));
    this.requestPump();
  }

  resume(): void {
    this.accepting = true;
    this.requestPump();
  }

  wake(): void {
    this.requestPump();
  }

  activeCountForUser(userId: number): number {
    return this.activeByUser.get(userId) ?? 0;
  }

  hasActiveRun(runId: string): boolean {
    return this.active.has(runId);
  }

  activeRunIds(): string[] {
    return [...this.active.keys()];
  }

  private async pump(): Promise<void> {
    if (this.pumping || !this.accepting) return;
    this.pumping = true;
    try {
      const blockedSeen = new Set<string>();
      while (this.accepting) {
        const next = this.nextQueued();
        if (!next) break;
        try {
          if (this.runBlocked(next.run.id)) {
            this.requeueBack(next);
            if (blockedSeen.has(next.run.id)) break;
            blockedSeen.add(next.run.id);
            continue;
          }
          const configured = await this.settings.get(next.run.userId);
          const maxConcurrent = Math.max(
            1,
            Math.min(
              configured.effectiveSettings.performance.maxConcurrentRuntimes,
              configured.effectiveSettings.hardLimits.maxConcurrentRuntimes,
            ),
          );
          if (this.activeCountForUser(next.run.userId) + this.externalActiveCount(next.run.userId) >= maxConcurrent) {
            this.requeueFront(next);
            break;
          }
          this.start(next.run);
        } catch (error) {
          this.scheduleRetry(next.run, 'preflight_failed', error);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private start(run: RunView): void {
    const controller = new AbortController();
    const startedAt = this.clock.nowUnixMilliseconds();
    logger.info(
      {
        runId: run.id,
        threadId: run.threadId,
        appId: run.appId,
        userId: run.userId,
        status: run.status,
        providerId: run.definition.model.providerId,
        modelId: run.definition.model.modelId,
        reasoningEffort: run.definition.reasoningEffort ?? null,
      },
      'Agent scheduler started run',
    );
    const done = (async () => {
      let retryError: unknown = null;
      try {
        for await (const signal of this.backend.execute(run, controller.signal)) {
          if (signal.type === 'durable') {
            this.events.publishRunWake(signal.runId, signal.cursor);
            void this.hostCursor(run.userId)
              .then((cursor) => this.events.publishHostWake(run.userId, cursor))
              .catch((error) =>
                logger.warn({ err: error, userId: run.userId, runId: run.id }, 'Agent host wake cursor lookup failed'),
              );
          } else if (signal.type === 'transient') {
            const occurredAt = this.clock.nowUnixSeconds();
            if (signal.eventType === 'message.delta') {
              this.events.publishTransient({
                runId: signal.runId,
                type: 'message.delta',
                payload: signal.payload,
                occurredAt,
              });
            } else {
              this.events.publishTransient({
                runId: signal.runId,
                type: 'tool.delta',
                payload: signal.payload,
                occurredAt,
              });
            }
          }
        }
      } catch (error) {
        retryError = error;
        logger.error(
          { runId: run.id, threadId: run.threadId, appId: run.appId, userId: run.userId, err: error },
          'Agent scheduler run failed outside persisted harness',
        );
      } finally {
        logger.info(
          {
            runId: run.id,
            threadId: run.threadId,
            appId: run.appId,
            userId: run.userId,
            aborted: controller.signal.aborted,
            abortReason:
              controller.signal.reason instanceof Error
                ? controller.signal.reason.message
                : controller.signal.reason === undefined
                  ? null
                  : String(controller.signal.reason),
            elapsedMs: Math.max(0, this.clock.nowUnixMilliseconds() - startedAt),
          },
          'Agent scheduler finished run execution',
        );
        this.active.delete(run.id);
        this.decrementActiveUser(run.userId);
        if (retryError !== null && !controller.signal.aborted) {
          this.scheduleRetry(run, 'execution_recovery_failed', retryError);
        } else {
          this.retryAttempts.delete(run.id);
        }
        this.requestPump();
      }
    })();
    this.incrementActiveUser(run.userId);
    this.active.set(run.id, { run, controller, done });
  }

  private incrementActiveUser(userId: number): void {
    this.activeByUser.set(userId, (this.activeByUser.get(userId) ?? 0) + 1);
  }

  private decrementActiveUser(userId: number): void {
    const current = this.activeByUser.get(userId) ?? 0;
    if (current <= 1) this.activeByUser.delete(userId);
    else this.activeByUser.set(userId, current - 1);
  }

  private nextQueued(): QueuedRun | null {
    if (this.appOrder.length === 0) return null;
    for (let offset = 0; offset < this.appOrder.length; offset += 1) {
      const index = (this.appCursor + offset) % this.appOrder.length;
      const appId = this.appOrder[index]!;
      const queue = this.queues.get(appId);
      const next = queue?.shift();
      if (!next) continue;
      this.appCursor = (index + 1) % this.appOrder.length;
      if (queue?.length === 0) {
        this.queues.delete(appId);
        const removeIndex = this.appOrder.indexOf(appId);
        if (removeIndex >= 0) this.appOrder.splice(removeIndex, 1);
        if (this.appOrder.length > 0) this.appCursor %= this.appOrder.length;
        else this.appCursor = 0;
      }
      return next;
    }
    this.queues.clear();
    this.appOrder.length = 0;
    this.appCursor = 0;
    return null;
  }

  private requeueFront(value: QueuedRun): void {
    let queue = this.queues.get(value.run.appId);
    if (!queue) {
      queue = [];
      this.queues.set(value.run.appId, queue);
      if (!this.appOrder.includes(value.run.appId)) this.appOrder.push(value.run.appId);
    }
    queue.unshift(value);
  }

  private requeueBack(value: QueuedRun): void {
    let queue = this.queues.get(value.run.appId);
    if (!queue) {
      queue = [];
      this.queues.set(value.run.appId, queue);
      if (!this.appOrder.includes(value.run.appId)) this.appOrder.push(value.run.appId);
    }
    queue.push(value);
  }

  private requestPump(): void {
    void this.pump().catch((error) => {
      logger.error({ err: error }, 'Agent scheduler pump failed');
    });
  }

  private scheduleRetry(run: RunView, reason: 'preflight_failed' | 'execution_recovery_failed', error: unknown): void {
    if (
      !this.accepting ||
      this.pausedScopes.has(scopeKey({ userId: run.userId, appId: run.appId })) ||
      !['created', 'running'].includes(run.status) ||
      this.scheduledRetries.has(run.id)
    ) {
      return;
    }
    const attempt = (this.retryAttempts.get(run.id) ?? 0) + 1;
    this.retryAttempts.set(run.id, attempt);
    const delayMs = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 6));
    logger.warn(
      {
        err: error,
        runId: run.id,
        threadId: run.threadId,
        appId: run.appId,
        userId: run.userId,
        reason,
        attempt,
        retryDelayMs: delayMs,
      },
      'Agent scheduler retained run for retry',
    );
    const timer = setTimeout(() => {
      this.scheduledRetries.delete(run.id);
      if (
        !this.accepting ||
        this.pausedScopes.has(scopeKey({ userId: run.userId, appId: run.appId })) ||
        !['created', 'running'].includes(run.status)
      ) {
        return;
      }
      this.enqueue(run);
    }, delayMs);
    timer.unref?.();
    this.scheduledRetries.set(run.id, { run, timer });
  }
}
