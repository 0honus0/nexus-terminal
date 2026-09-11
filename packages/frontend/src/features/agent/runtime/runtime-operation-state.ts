import { computed, ref } from 'vue';
import { AgentApiError, toAgentApiError } from '../api/agent-api-error';

export type RuntimeOperationPhase = 'idle' | 'loading' | 'mutating' | 'conflict' | 'reconciling' | 'failed';

export interface RuntimeFailureDecision {
  phase: 'conflict' | 'reconciling' | 'failed';
  error: AgentApiError;
  refreshAuthoritativeState: boolean;
}

const reconciliationCodes = new Set([
  'RECONCILIATION_REQUIRED',
  'RUN_DELETE_RECONCILIATION_REQUIRED',
  'WORKSPACE_RECONCILIATION_REQUIRED',
  'WORKSPACE_OUTCOME_UNKNOWN',
]);

const commandIdsFromDetails = (details: unknown): string[] => {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  const commandIds = (details as { commandIds?: unknown }).commandIds;
  if (!Array.isArray(commandIds)) return [];
  return [...new Set(commandIds.filter((value): value is string => typeof value === 'string' && value.length > 0))];
};

export const classifyRuntimeFailure = (cause: unknown): RuntimeFailureDecision => {
  const error = toAgentApiError(cause);
  if (reconciliationCodes.has(error.code)) {
    return { phase: 'reconciling', error, refreshAuthoritativeState: true };
  }
  if (error.status === 409 || error.code.endsWith('_CONFLICT') || error.code.endsWith('_STALE')) {
    return { phase: 'conflict', error, refreshAuthoritativeState: true };
  }
  return { phase: 'failed', error, refreshAuthoritativeState: false };
};

export const createRuntimeOperationState = () => {
  const phase = ref<RuntimeOperationPhase>('idle');
  const failure = ref<AgentApiError | null>(null);
  const reconciliationCommandIds = ref<string[]>([]);

  const clearFailure = (): void => {
    failure.value = null;
    reconciliationCommandIds.value = [];
  };

  const beginLoading = (): void => {
    clearFailure();
    phase.value = 'loading';
  };

  const beginMutation = (): void => {
    clearFailure();
    phase.value = 'mutating';
  };

  const succeed = (): void => {
    clearFailure();
    phase.value = 'idle';
  };

  const fail = (cause: unknown): RuntimeFailureDecision => {
    const decision = classifyRuntimeFailure(cause);
    failure.value = decision.error;
    reconciliationCommandIds.value = commandIdsFromDetails(decision.error.details);
    phase.value = decision.phase;
    return decision;
  };

  const markReconciling = (code: string, message: string, commandIds: readonly string[] = []): AgentApiError => {
    const error = new AgentApiError({ code, message, details: { commandIds: [...new Set(commandIds)] } });
    failure.value = error;
    reconciliationCommandIds.value = [...new Set(commandIds)];
    phase.value = 'reconciling';
    return error;
  };

  const updateReconciliationCommands = (commandIds: readonly string[]): void => {
    reconciliationCommandIds.value = [...new Set(commandIds)];
  };

  const mutationBlocked = computed(
    () => phase.value === 'mutating' || phase.value === 'conflict' || phase.value === 'reconciling',
  );

  return {
    phase,
    failure,
    reconciliationCommandIds,
    mutationBlocked,
    beginLoading,
    beginMutation,
    succeed,
    fail,
    markReconciling,
    updateReconciliationCommands,
  };
};

export type RuntimeOperationState = ReturnType<typeof createRuntimeOperationState>;
