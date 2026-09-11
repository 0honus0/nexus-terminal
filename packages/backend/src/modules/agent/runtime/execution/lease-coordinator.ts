import type { ClockPort, JsonValue } from '../../agent.types';
import type {
  LeaseMode,
  LeaseOwner,
  LeasePort,
  ResourceLease,
  ResourceQuarantine,
} from '../../capabilities/lease.port';
import { executionErrorCode, waitForRetry } from './execution-errors';

export interface LeaseRenewal {
  signal: AbortSignal;
  stop(): Promise<unknown | null>;
}

export class LeaseCoordinator {
  constructor(
    private readonly leases: LeasePort,
    private readonly clock: ClockPort,
  ) {}

  async acquireWithRetry(
    owner: LeaseOwner,
    resourceKeys: readonly string[],
    mode: LeaseMode,
    ttlSeconds: number,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<ResourceLease[]> {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
      if (this.clock.nowUnixSeconds() >= deadlineAt) throw new Error('TOOL_TIMEOUT');
      try {
        return await this.leases.acquireMany(owner, resourceKeys, mode, ttlSeconds);
      } catch (error) {
        if (executionErrorCode(error, 'LEASE_ACQUIRE_FAILED') !== 'LEASE_CONFLICT') throw error;
        await waitForRetry(Math.min(500, Math.max(50, deadlineAt * 1000 - Date.now())), signal);
      }
    }
  }

  startRenewal(
    leaseIds: readonly string[],
    owner: LeaseOwner,
    ttlSeconds: number,
    parentSignal: AbortSignal,
  ): LeaseRenewal {
    const controller = new AbortController();
    let stopped = false;
    let renewalError: unknown | null = null;
    let tail = Promise.resolve();
    const abortFromParent = (): void => {
      if (!controller.signal.aborted) controller.abort(parentSignal.reason ?? new Error('ABORTED'));
    };
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
    const renew = (): void => {
      tail = tail.then(async () => {
        if (stopped || controller.signal.aborted) return;
        try {
          await this.leases.renew(leaseIds, owner, ttlSeconds);
        } catch (error) {
          renewalError = error;
          controller.abort(error);
        }
      });
    };
    const timer = setInterval(renew, 10_000);
    timer.unref?.();
    return {
      signal: controller.signal,
      stop: async () => {
        if (!stopped) {
          stopped = true;
          clearInterval(timer);
          parentSignal.removeEventListener('abort', abortFromParent);
        }
        await tail.catch(() => undefined);
        return renewalError;
      },
    };
  }

  release(leaseIds: readonly string[], owner: LeaseOwner): Promise<void> {
    return this.leases.release(leaseIds, owner);
  }

  quarantine(
    owner: LeaseOwner,
    resourceKeys: readonly string[],
    reason: string,
    evidence: JsonValue,
    toolCallId?: string,
  ): Promise<ResourceQuarantine[]> {
    return this.leases.quarantine(owner, resourceKeys, reason, evidence, toolCallId);
  }
}
