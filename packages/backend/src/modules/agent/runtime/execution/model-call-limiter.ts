import type { AgentSettingsService } from '../../host/agent-settings.service';

interface Waiter {
  userId: number;
  resolve: () => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

export class ModelCallLimiter {
  private readonly activeByUser = new Map<number, number>();
  private readonly waiters: Waiter[] = [];

  constructor(private readonly settings: AgentSettingsService) {}

  async acquire(userId: number, signal: AbortSignal): Promise<() => void> {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
      const limit = await this.effectiveLimit(userId);
      const active = this.activeByUser.get(userId) ?? 0;
      if (active < limit) {
        this.activeByUser.set(userId, active + 1);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          const current = this.activeByUser.get(userId) ?? 1;
          if (current <= 1) this.activeByUser.delete(userId);
          else this.activeByUser.set(userId, current - 1);
          this.wakeNext(userId);
        };
      }
      await this.wait(userId, signal);
    }
  }

  active(userId: number): number {
    return this.activeByUser.get(userId) ?? 0;
  }

  private async effectiveLimit(userId: number): Promise<number> {
    const settings = await this.settings.get(userId);
    const runtimeLimit = Math.max(
      1,
      Math.min(settings.effectiveSettings.performance.maxConcurrentRuntimes, settings.hardLimits.maxConcurrentRuntimes),
    );
    const requested = settings.effectiveSettings.performance.maxConcurrentModelCalls;
    const modelLimit = requested === 'auto' ? runtimeLimit : requested;
    return Math.max(1, Math.min(modelLimit, settings.hardLimits.maxConcurrentModelCalls, runtimeLimit));
  }

  private wait(userId: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        userId,
        resolve: () => {
          signal.removeEventListener('abort', waiter.onAbort);
          resolve();
        },
        reject,
        signal,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(signal.reason ?? new Error('ABORTED'));
        },
      };
      signal.addEventListener('abort', waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private wakeNext(userId: number): void {
    const index = this.waiters.findIndex((waiter) => waiter.userId === userId);
    if (index < 0) return;
    const [waiter] = this.waiters.splice(index, 1);
    waiter?.resolve();
  }
}
