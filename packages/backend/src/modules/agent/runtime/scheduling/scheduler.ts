import type { AgentSettingsService } from '../../host/agent-settings.service';
import type { AgentBackendPort } from '../execution/agent-backend.port';
import { AgentEventHub } from '../events/event-hub';
import type { RunView } from '../runs/run.types';

interface QueuedRun {
  run: RunView;
  enqueuedAt: number;
}

export class AgentScheduler {
  private readonly queues = new Map<string, QueuedRun[]>();
  private readonly appOrder: string[] = [];
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private appCursor = 0;
  private accepting = true;
  private pumping = false;

  constructor(
    private readonly settings: AgentSettingsService,
    private readonly backend: AgentBackendPort,
    private readonly events: AgentEventHub,
    private readonly hostCursor: (userId: number) => Promise<number>,
    private readonly externalActiveCount: (userId: number) => number = () => 0,
    private readonly runBlocked: (runId: string) => boolean = () => false,
  ) {}

  enqueue(run: RunView): void {
    if (!this.accepting || !['created', 'running'].includes(run.status)) return;
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
    queue.push({ run, enqueuedAt: Date.now() });
    void this.pump();
  }

  signalInput(run: RunView): boolean {
    const active = this.active.get(run.id);
    if (!active) return false;
    active.controller.abort(new Error('NEW_INPUT'));
    void active.done.finally(() => this.enqueue(run));
    return true;
  }

  cancel(runId: string): boolean {
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
    this.queues.clear();
    this.appOrder.length = 0;
    for (const active of this.active.values()) active.controller.abort(new Error('AGENT_QUIESCE'));
    const remainingMs = Math.max(0, deadlineUnixSeconds * 1000 - Date.now());
    if (this.active.size === 0 || remainingMs === 0) return;
    await Promise.race([
      Promise.allSettled([...this.active.values()].map((active) => active.done)),
      new Promise<void>((resolve) => setTimeout(resolve, remainingMs)),
    ]);
    if (this.active.size > 0) throw new Error('APP_QUIESCE_TIMEOUT');
  }

  resume(): void {
    this.accepting = true;
    void this.pump();
  }

  wake(): void {
    void this.pump();
  }

  get activeCount(): number {
    return this.active.size;
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
        if (this.active.size + this.externalActiveCount(next.run.userId) >= maxConcurrent) {
          this.requeueFront(next);
          break;
        }
        this.start(next.run);
      }
    } finally {
      this.pumping = false;
    }
  }

  private start(run: RunView): void {
    const controller = new AbortController();
    const done = (async () => {
      try {
        for await (const signal of this.backend.execute(run, controller.signal)) {
          if (signal.type === 'durable') {
            this.events.publishRunWake(signal.runId, signal.cursor);
            void this.hostCursor(run.userId)
              .then((cursor) => this.events.publishHostWake(run.userId, cursor))
              .catch(() => undefined);
          } else if (signal.type === 'transient') {
            this.events.publishTransient({
              runId: signal.runId,
              type: signal.eventType,
              payload: signal.payload,
              occurredAt: Math.floor(Date.now() / 1000),
            });
          }
        }
      } catch (error) {
        console.error(`[Agent Scheduler] run ${run.id} failed outside the persisted harness:`, error);
      } finally {
        this.active.delete(run.id);
        void this.pump();
      }
    })();
    this.active.set(run.id, { controller, done });
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
}
