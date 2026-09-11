import { randomInt } from 'node:crypto';
import type { ClockPort, Scope } from '../../agent.types';
import type { AgentSettingsService } from '../../host/agent-settings.service';
import type { SubagentParticipantExecutor } from './subagent-participant-executor';
import type { RunScopeRepositoryPort, SchedulerWorkClaimPort } from './subagent.repository.port';
import type { SchedulerWorkView } from './subagent.types';

const CONTROL_POLL_MS = 500;

interface ActiveChild {
  scope: Scope;
  runId: string;
  controller: AbortController;
  done: Promise<void>;
}

export interface RootSchedulerView {
  readonly activeCount: number;
  hasActiveRun(runId: string): boolean;
  activeRunIds(): string[];
  enqueueRun(runId: string, scope: Scope): Promise<void>;
  wake(): void;
}

/**
 * Persistent scheduler for child runtimes. It owns durable work scanning,
 * fairness, capacity, claim CAS, active execution tracking, and quiesce. The
 * already-claimed participant work is executed by SubagentParticipantExecutor.
 */
export class SubagentScheduler {
  private readonly active = new Map<string, ActiveChild>();
  private readonly ownerEpoch = Date.now() * 1_000 + randomInt(1, 1_000);
  private accepting = false;
  private pumping = false;
  private timer: NodeJS.Timeout | null = null;
  private appCursor = 0;
  private runCursorByApp = new Map<string, number>();

  constructor(
    private readonly settings: AgentSettingsService,
    private readonly runScopes: RunScopeRepositoryPort,
    private readonly work: SchedulerWorkClaimPort,
    private readonly participant: SubagentParticipantExecutor,
    private readonly roots: RootSchedulerView,
    private readonly clock: ClockPort,
  ) {}

  async initialize(): Promise<void> {
    await this.work.resetClaimedWork(this.ownerEpoch, this.clock.nowUnixSeconds());
    this.resume();
  }

  resume(): void {
    this.accepting = true;
    if (!this.timer) {
      this.timer = setInterval(() => this.wake(), CONTROL_POLL_MS);
      this.timer.unref?.();
    }
    this.wake();
  }

  wake(): void {
    if (!this.accepting) return;
    void this.pump();
  }

  async quiesce(deadlineUnixSeconds: number): Promise<void> {
    this.accepting = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const active of this.active.values()) active.controller.abort(new Error('AGENT_QUIESCE'));
    const remainingMs = Math.max(0, deadlineUnixSeconds * 1000 - Date.now());
    if (this.active.size === 0 || remainingMs === 0) return;
    await Promise.race([
      Promise.allSettled([...this.active.values()].map((active) => active.done)),
      new Promise<void>((resolve) => setTimeout(resolve, remainingMs)),
    ]);
    if (this.active.size > 0) throw new Error('APP_QUIESCE_TIMEOUT');
  }

  async dispose(): Promise<void> {
    await this.quiesce(this.clock.nowUnixSeconds() + 10).catch(() => undefined);
  }

  get activeCount(): number {
    return this.active.size;
  }

  activeCountForUser(userId: number): number {
    return this.activeForUser(userId);
  }

  hasActiveRun(runId: string): boolean {
    for (const active of this.active.values()) if (active.runId === runId) return true;
    return false;
  }

  private async pump(): Promise<void> {
    if (this.pumping || !this.accepting) return;
    this.pumping = true;
    try {
      let safety = 0;
      while (this.accepting && safety < 64) {
        safety += 1;
        const now = this.clock.nowUnixSeconds();
        const terminalCandidates = await this.work.terminalWork(now, 64);
        if (terminalCandidates.length > 0) {
          const handled = await this.handleTerminalCandidate(terminalCandidates[0]!);
          if (handled) continue;
        }
        const candidates = await this.work.readyWork(now, 128, this.roots.activeRunIds());
        if (candidates.length === 0) break;
        const candidate = await this.pickCandidate(candidates);
        if (!candidate) break;
        const scope = await this.runScopes.scopeForRun(candidate.runId);
        if (!scope) {
          await this.work.claimWork(candidate.id, candidate.version, this.ownerEpoch, this.clock.nowUnixSeconds());
          continue;
        }
        const configured = await this.settings.get(scope.userId);
        const maxConcurrent = Math.max(
          1,
          Math.min(
            configured.effectiveSettings.performance.maxConcurrentRuntimes,
            configured.effectiveSettings.hardLimits.maxConcurrentRuntimes,
          ),
        );
        if (this.roots.activeCount + this.activeForUser(scope.userId) >= maxConcurrent) break;
        const claimed = await this.work.claimWork(
          candidate.id,
          candidate.version,
          this.ownerEpoch,
          this.clock.nowUnixSeconds(),
        );
        if (!claimed) continue;
        if (claimed.kind === 'consume_inbox') {
          await this.participant
            .handleInboxWake(scope, claimed, this.ownerEpoch)
            .catch((error) => console.error(`[Agent SubagentScheduler] inbox work ${claimed.id} failed:`, error));
          continue;
        }
        if (claimed.kind !== 'model_step' && claimed.kind !== 'tool_step') {
          await this.work
            .settleWork(claimed.id, this.ownerEpoch, 'cancelled', this.clock.nowUnixSeconds())
            .catch(() => undefined);
          continue;
        }
        this.start(scope, claimed);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async handleTerminalCandidate(work: SchedulerWorkView): Promise<boolean> {
    const scope = await this.runScopes.scopeForRun(work.runId);
    if (!scope) return false;
    const claimed = await this.work.claimWork(work.id, work.version, this.ownerEpoch, this.clock.nowUnixSeconds());
    if (!claimed) return false;
    await this.participant.handleTerminalCandidate(scope, claimed, this.ownerEpoch);
    return true;
  }

  private activeForUser(userId: number): number {
    let count = 0;
    for (const value of this.active.values()) if (value.scope.userId === userId) count += 1;
    return count;
  }

  private async pickCandidate(candidates: SchedulerWorkView[]): Promise<SchedulerWorkView | null> {
    const enriched: Array<{ work: SchedulerWorkView; scope: Scope }> = [];
    for (const work of candidates) {
      const scope = await this.runScopes.scopeForRun(work.runId);
      if (scope) enriched.push({ work, scope });
    }
    if (enriched.length === 0) return null;
    const apps = [...new Set(enriched.map((item) => item.scope.appId))].sort();
    if (apps.length === 0) return null;
    const appIndex = this.appCursor % apps.length;
    for (let appOffset = 0; appOffset < apps.length; appOffset += 1) {
      const resolvedAppIndex = (appIndex + appOffset) % apps.length;
      const appId = apps[resolvedAppIndex]!;
      const withinApp = enriched.filter((item) => item.scope.appId === appId);
      if (withinApp.length === 0) continue;
      const runs = [...new Set(withinApp.map((item) => item.work.runId))].sort();
      const runCursor = this.runCursorByApp.get(appId) ?? 0;
      for (let runOffset = 0; runOffset < runs.length; runOffset += 1) {
        const resolvedRunIndex = (runCursor + runOffset) % runs.length;
        const runId = runs[resolvedRunIndex]!;
        const choices = withinApp
          .filter((item) => item.work.runId === runId)
          .map((item) => item.work)
          .sort((left, right) => {
            const now = this.clock.nowUnixSeconds();
            const leftAged = now - left.createdAt >= 10 ? 0 : 1;
            const rightAged = now - right.createdAt >= 10 ? 0 : 1;
            return leftAged - rightAged || left.enqueueSequence - right.enqueueSequence;
          });
        const selected = choices[0];
        if (!selected) continue;
        this.appCursor = (resolvedAppIndex + 1) % apps.length;
        this.runCursorByApp.set(appId, (resolvedRunIndex + 1) % runs.length);
        return selected;
      }
    }
    return null;
  }

  private start(scope: Scope, work: SchedulerWorkView): void {
    const controller = new AbortController();
    const done = this.participant
      .execute(scope, work, this.ownerEpoch, controller.signal)
      .catch((error) => console.error(`[Agent SubagentScheduler] child work ${work.id} failed:`, error))
      .finally(() => {
        this.active.delete(work.id);
        this.roots.wake();
        this.wake();
      });
    this.active.set(work.id, { scope, runId: work.runId, controller, done });
  }
}
