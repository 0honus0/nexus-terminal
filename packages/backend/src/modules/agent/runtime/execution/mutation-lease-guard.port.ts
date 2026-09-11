import type { JsonValue } from '../../agent.types';

export interface MutationLeaseGuardRequest {
  runtimeId: string;
  operationId: string;
  resourceKeys: readonly string[];
  ttlSeconds: number;
  signal: AbortSignal;
  deadlineAt: number;
}

export interface MutationLeaseGuardHandle {
  readonly signal: AbortSignal;
  stopRenewal(): Promise<unknown | null>;
  activate(): Promise<void>;
  quarantine(reason: string, evidence: JsonValue): Promise<void>;
  confirm(): Promise<void>;
  releaseIfInactive(): Promise<void>;
}

/**
 * Staged Agent mutation lease capability.
 *
 * The caller must durably begin the mutation through StateCommit after acquire() and before
 * activate(). This preserves the authority order: Lease -> durable mutation state -> active
 * mutation marker -> side effect -> durable settle -> lease settle/release or quarantine.
 */
export interface MutationLeaseGuardPort {
  acquire(request: MutationLeaseGuardRequest): Promise<MutationLeaseGuardHandle>;
}
