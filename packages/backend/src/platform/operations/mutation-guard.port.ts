export type MutationGuardOwnerType = 'agent' | 'workspace' | 'system';

export interface MutationGuardRequest {
  ownerType: MutationGuardOwnerType;
  ownerId: string;
  operationId: string;
  resourceKeys: readonly string[];
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
