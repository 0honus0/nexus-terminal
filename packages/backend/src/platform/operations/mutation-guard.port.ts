export type MutationGuardOwnerType = 'agent' | 'workspace' | 'system';

export interface MutationGuardRequest {
  ownerType: MutationGuardOwnerType;
  /** Stable product/runtime actor identity used for attribution. */
  ownerId: string;
  /**
   * Optional concrete lease-holder identity. Concurrent operations from one actor should use
   * distinct holder ids; serialized callers can omit it and use ownerId directly.
   */
  leaseOwnerId?: string;
  operationId: string;
  /** Resources mutated by the operation; acquired as write leases. */
  resourceKeys: readonly string[];
  /** Broader coordination resources acquired as shared read leases. */
  readResourceKeys?: readonly string[];
  timeoutSeconds?: number;
  signal?: AbortSignal;
}

export interface MutationGuardHandle {
  readonly signal: AbortSignal;
  confirm(): Promise<void>;
  unknown(reason: string, evidence?: Record<string, unknown>): Promise<void>;
}

/**
 * Coordinates typed mutations across otherwise independent product surfaces.
 * A handle can span multi-message operations (for example chunked upload); callers
 * must finish it with confirm() or unknown().
 */
export interface MutationGuardPort {
  beginMutation(request: MutationGuardRequest): Promise<MutationGuardHandle>;
  withMutation<T>(request: MutationGuardRequest, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
}
