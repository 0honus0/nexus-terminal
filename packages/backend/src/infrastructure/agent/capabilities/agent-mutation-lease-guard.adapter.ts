import type { ClockPort, JsonValue } from '../../../modules/agent/agent.types';
import type { LeaseOwner, LeasePort } from '../../../modules/agent/capabilities/lease.port';
import type {
  MutationLeaseGuardHandle,
  MutationLeaseGuardPort,
  MutationLeaseGuardRequest,
} from '../../../modules/agent/runtime/execution/mutation-lease-guard.port';

const RETRY_DELAY_MS = 100;

const errorCode = (error: unknown, fallback: string): string => {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return fallback;
};

const wait = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('ABORTED'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('ABORTED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });

export class AgentMutationLeaseGuardAdapter implements MutationLeaseGuardPort {
  constructor(
    private readonly leases: LeasePort,
    private readonly clock: ClockPort,
  ) {}

  async acquire(request: MutationLeaseGuardRequest): Promise<MutationLeaseGuardHandle> {
    const owner: LeaseOwner = { type: 'agent', id: request.runtimeId };
    const acquired = await this.acquireWithRetry(owner, request);
    const leaseIds = acquired.map((lease) => lease.id);
    const controller = new AbortController();
    let renewalError: unknown | null = null;
    let renewalTail = Promise.resolve();
    let renewalStopped = false;
    let active = false;
    let released = false;

    const abortFromParent = (): void => {
      if (!controller.signal.aborted) controller.abort(request.signal.reason ?? new Error('ABORTED'));
    };
    if (request.signal.aborted) abortFromParent();
    else request.signal.addEventListener('abort', abortFromParent, { once: true });

    const renew = (): void => {
      renewalTail = renewalTail.then(async () => {
        if (renewalStopped || controller.signal.aborted) return;
        try {
          await this.leases.renew(leaseIds, owner, request.ttlSeconds);
        } catch (error) {
          renewalError = error;
          controller.abort(error);
        }
      });
    };
    const timer = setInterval(renew, 10_000);
    timer.unref?.();

    const stopRenewal = async (): Promise<unknown | null> => {
      if (!renewalStopped) {
        renewalStopped = true;
        clearInterval(timer);
        request.signal.removeEventListener('abort', abortFromParent);
      }
      await renewalTail.catch(() => undefined);
      return renewalError;
    };

    const quarantine = async (reason: string, evidence: JsonValue): Promise<void> => {
      await stopRenewal().catch(() => undefined);
      await this.leases.quarantine(owner, request.resourceKeys, reason, evidence, request.operationId);
    };

    const releaseIfInactive = async (): Promise<void> => {
      await stopRenewal().catch(() => undefined);
      if (active || released) return;
      await this.leases.release(leaseIds, owner);
      released = true;
    };

    return {
      signal: controller.signal,
      stopRenewal,
      activate: async () => {
        if (released) throw new Error('LEASE_LOST');
        await this.leases.markMutationActive(leaseIds, owner, request.operationId);
        active = true;
      },
      quarantine,
      confirm: async () => {
        if (!active || released) throw new Error('LEASE_LOST');
        await stopRenewal().catch(() => undefined);
        try {
          await this.leases.markMutationSettled(leaseIds, owner, request.operationId);
          active = false;
          await this.leases.release(leaseIds, owner);
          released = true;
        } catch (error) {
          await quarantine('LEASE_STATE_UNCERTAIN_AFTER_MUTATION', {
            toolCallId: request.operationId,
            errorCode: errorCode(error, 'LEASE_STATE_UNCERTAIN'),
          }).catch(() => undefined);
          if (!active && !released) {
            await this.leases
              .release(leaseIds, owner)
              .then(() => {
                released = true;
              })
              .catch(() => undefined);
          }
        }
      },
      releaseIfInactive,
    };
  }

  private async acquireWithRetry(owner: LeaseOwner, request: MutationLeaseGuardRequest) {
    while (true) {
      if (request.signal.aborted) throw request.signal.reason ?? new Error('ABORTED');
      if (this.clock.nowUnixSeconds() >= request.deadlineAt) throw new Error('TOOL_TIMEOUT');
      try {
        return await this.leases.acquireMany(owner, request.resourceKeys, 'write', request.ttlSeconds);
      } catch (error) {
        if (errorCode(error, 'LEASE_ACQUIRE_FAILED') !== 'LEASE_CONFLICT') throw error;
        await wait(RETRY_DELAY_MS, request.signal);
      }
    }
  }
}
