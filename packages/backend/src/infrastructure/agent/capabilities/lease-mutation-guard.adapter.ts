import type { JsonValue } from '../../../modules/agent/agent.types';
import type { LeaseOwner, LeasePort } from '../../../modules/agent/capabilities/lease.port';
import type {
  MutationGuardHandle,
  MutationGuardPort,
  MutationGuardRequest,
} from '../../../platform/operations/mutation-guard.port';

const DEFAULT_TIMEOUT_SECONDS = 60;
const LEASE_TTL_SECONDS = 30;
const RETRY_DELAY_MS = 100;

const code = (error: unknown): string => {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  return 'MUTATION_FAILED';
};

const wait = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('ABORTED'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('ABORTED'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export class LeaseMutationGuardAdapter implements MutationGuardPort {
  constructor(private readonly leases: LeasePort) {}

  async beginMutation(request: MutationGuardRequest): Promise<MutationGuardHandle> {
    const timeoutSeconds = request.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 300) {
      throw new Error('VALIDATION_FAILED');
    }
    if (!request.ownerId || !request.operationId || request.resourceKeys.length < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const readResourceKeys = request.readResourceKeys ?? [];
    const mutationResourceKeys = [...new Set([...readResourceKeys, ...request.resourceKeys])];
    const owner: LeaseOwner = { type: request.ownerType, id: request.leaseOwnerId ?? request.ownerId };
    const deadline = Date.now() + timeoutSeconds * 1000;
    const parent = request.signal;
    const controller = new AbortController();
    const onAbort = () => controller.abort(parent?.reason ?? new Error('ABORTED'));
    if (parent?.aborted) onAbort();
    else parent?.addEventListener('abort', onAbort, { once: true });

    let leaseIds: string[] = [];
    try {
      while (true) {
        if (controller.signal.aborted) throw controller.signal.reason ?? new Error('ABORTED');
        if (Date.now() >= deadline) throw new Error('LEASE_CONFLICT');
        try {
          const acquired = readResourceKeys.length
            ? await this.leases.acquireResources(
                owner,
                [
                  ...readResourceKeys.map((resourceKey) => ({ resourceKey, mode: 'read' as const })),
                  ...request.resourceKeys.map((resourceKey) => ({ resourceKey, mode: 'write' as const })),
                ],
                LEASE_TTL_SECONDS,
              )
            : await this.leases.acquireMany(owner, request.resourceKeys, 'write', LEASE_TTL_SECONDS);
          leaseIds = acquired.map((lease) => lease.id);
          break;
        } catch (error) {
          if (code(error) !== 'LEASE_CONFLICT') throw error;
          await wait(Math.min(RETRY_DELAY_MS, Math.max(1, deadline - Date.now())), controller.signal);
        }
      }
      await this.leases.markMutationActive(leaseIds, owner, request.operationId);
    } catch (error) {
      parent?.removeEventListener('abort', onAbort);
      if (leaseIds.length) await this.leases.release(leaseIds, owner).catch(() => undefined);
      throw error;
    }

    let settled = false;
    let renewalError: unknown = null;
    let renewalTail = Promise.resolve();
    const renew = (): void => {
      renewalTail = renewalTail.then(async () => {
        if (settled || controller.signal.aborted) return;
        try {
          await this.leases.renew(leaseIds, owner, LEASE_TTL_SECONDS);
        } catch (error) {
          renewalError = error;
          controller.abort(error);
        }
      });
    };
    const timer = setInterval(renew, 10_000);
    timer.unref?.();

    const finish = async (known: boolean, reason?: string, evidence?: Record<string, unknown>): Promise<void> => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      parent?.removeEventListener('abort', onAbort);
      await renewalTail.catch(() => undefined);
      const effectiveReason = renewalError ? 'LEASE_RENEWAL_FAILED_DURING_MUTATION' : reason;
      if (!known || renewalError) {
        await this.leases
          .quarantine(owner, mutationResourceKeys, effectiveReason || 'MUTATION_OUTCOME_UNKNOWN', {
            operationId: request.operationId,
            actorOwnerId: request.ownerId,
            ...(renewalError ? { errorCode: code(renewalError) } : {}),
            ...(evidence ?? {}),
          } as JsonValue)
          .catch(() => undefined);
        return;
      }
      await this.leases.markMutationSettled(leaseIds, owner, request.operationId);
      await this.leases.release(leaseIds, owner);
      leaseIds = [];
    };

    return {
      signal: controller.signal,
      confirm: () => finish(true),
      unknown: (reason, evidence) => finish(false, reason, evidence),
    };
  }

  async withMutation<T>(request: MutationGuardRequest, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const handle = await this.beginMutation(request);
    try {
      const result = await work(handle.signal);
      if (handle.signal.aborted) throw handle.signal.reason ?? new Error('LEASE_LOST');
      await handle.confirm();
      return result;
    } catch (error) {
      await handle.unknown('MUTATION_OUTCOME_UNKNOWN', { errorCode: code(error) }).catch(() => undefined);
      throw error;
    }
  }
}
