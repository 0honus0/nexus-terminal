import { computed, onBeforeUnmount, onMounted, ref, shallowRef, nextTick, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { logger } from '@/client/logging/logger';
import { useRuntimeFeatureCapabilities } from '@/shared/capabilities/public';
import { createConversationCommandExecutor, type ConversationCommandResult } from '../ai/conversation-command-executor';
import { parseConversationSubmission } from '../ai/conversation-commands';
import { agentApi, formatAgentApiError, toAgentApiError } from '../api/agent-api';
import { isAgentAppExecutableHealth, type AgentAppHealth } from '../app-availability';
import type {
  AgentApprovalModeDto,
  AgentExecutionModeDto,
  AgentApprovalBatchViewModel,
  AgentApprovalViewDto,
  AgentCheckpointViewDto,
  AgentArtifactRefDto,
  AgentDefinitionViewDto,
  AgentHardLimitsDto,
  AgentLedgerEntryDto,
  AgentModelCapabilityDto,
  AgentProviderViewDto,
  AgentReasoningEffortDto,
  AgentPendingUserInputRequestDto,
  AgentRunReconciliationViewDto,
  AgentRunSnapshotDto,
  AgentRunViewDto,
  AgentSettingsViewDto,
  AgentSubagentMessageDto,
  AgentSubagentViewDto,
  AgentThreadViewDto,
  AgentTargetDenylistViewDto,
} from '../api/agent-api';
import { agentRunAcceptsInput, isAgentRunNonTerminal } from '../api/agent-api';
import { agentHostEvents } from '../events/agent-host-events';
import { useAgentHostState } from './agent-host-state';
import {
  clearAgentSurfaceFailure,
  clearAgentSurfaceFailures,
  latestAgentSurfaceFailure,
  upsertAgentSurfaceFailure,
  type AgentSurfaceFailure,
} from './agent-surface-failures';
import { createAgentRunFacade } from '../runtime/run-facade';
import { createRuntimeOperationState } from '../runtime/runtime-operation-state';
import type AgentThreadSidebar from './AgentThreadSidebar.vue';

export interface AgentAppControllerProps {
  appId: string;
  defaultApprovalMode: AgentApprovalModeDto;
  appHealth: AgentAppHealth;
  appHealthReason: string | null;
}

/** Instance-owned application state and async lifecycle; the surface only renders it. */
export function useAgentAppController(props: Readonly<AgentAppControllerProps>) {
  const { t } = useI18n();

  const { surfaceSession: agentSurfaceSession, windowManager: agentWindowManager } = useAgentHostState();

  const facade = createAgentRunFacade(props.appId);

  const connectionsStore = useRuntimeFeatureCapabilities().connections;

  facade.start();

  const runtimeOperation = createRuntimeOperationState();

  const appExecutable = computed(() => isAgentAppExecutableHealth(props.appHealth));

  const threads = ref<AgentThreadViewDto[]>([]);

  const threadNextCursor = ref<string | null>(null);

  const threadListLoadingMore = ref(false);

  const THREAD_PAGE_MAX = 100;

  const currentThread = ref<AgentThreadViewDto | null>(null);

  const entries: Ref<AgentLedgerEntryDto[]> = ref([]);

  const nextCursor = ref<string | null>(null);

  const run: Ref<AgentRunViewDto | null> = ref(null);

  const pendingInputRequest = computed<AgentPendingUserInputRequestDto | null>(() => {
    const current = run.value;
    return current && 'pendingInputRequest' in current
      ? ((current as AgentRunSnapshotDto).pendingInputRequest ?? null)
      : null;
  });

  const reconciliationDetails = ref<AgentRunReconciliationViewDto | null>(null);

  const reconciliationBusy = ref(false);

  const threadRuns = ref<AgentRunViewDto[]>([]);

  const definitions = ref<AgentDefinitionViewDto[]>([]);

  const providers = ref<AgentProviderViewDto[]>([]);

  const targetDenylist = ref<AgentTargetDenylistViewDto | null>(null);

  const deniedConnectionIds = computed(
    () => new Set(targetDenylist.value?.list.map((entry) => entry.connectionId) ?? []),
  );

  const connections = computed(() => {
    if (!targetDenylist.value) return [];
    return connectionsStore.items.value.filter(
      (connection) => connection.type === 'SSH' && !deniedConnectionIds.value.has(connection.id),
    );
  });

  const restoredConnectionIds = agentSurfaceSession.restoreConnectionIds(props.appId);

  const selectedConnectionIds = ref<number[]>(restoredConnectionIds ?? []);

  const connectionSelectionExplicit = ref(restoredConnectionIds !== undefined);

  const attachments = ref<AgentArtifactRefDto[]>([]);

  const approvalBatch = shallowRef<AgentApprovalBatchViewModel | null>(null);

  const approvals = computed(() => approvalBatch.value?.items ?? []);

  const pendingApprovals = computed(() => approvals.value.filter((approval) => approval.status === 'requested'));

  const hardLimits = ref<AgentHardLimitsDto | null>(null);

  const settingsView = ref<AgentSettingsViewDto | null>(null);

  const backgroundRuns = ref<AgentRunViewDto[]>([]);

  const detailSnapshot: Ref<AgentRunSnapshotDto | null> = ref(null);

  const detailCheckpoints = ref<AgentCheckpointViewDto[]>([]);

  const currentRunCheckpoints = ref<AgentCheckpointViewDto[]>([]);

  const detailApprovalBatch = shallowRef<AgentApprovalBatchViewModel | null>(null);

  interface AgentSurfaceRetry {
    labelKey: string;
    run: () => void;
  }

  const DETAIL_FAILURE_DOMAIN = 'agent.operations.failureDomain.detail';

  const DETAIL_AUXILIARY_FAILURE_DOMAINS = [
    'agent.operations.failureDomain.checkpoints',
    'agent.operations.failureDomain.approvals',
    DETAIL_FAILURE_DOMAIN,
  ] as const;

  const THREAD_CONTEXT_FAILURE_DOMAINS = [
    'agent.operations.failureDomain.transcript',
    'agent.operations.failureDomain.stream',
    'agent.operations.failureDomain.run',
    'agent.operations.failureDomain.checkpoints',
    'agent.operations.failureDomain.approvals',
    DETAIL_FAILURE_DOMAIN,
    'agent.operations.failureDomain.mutation',
  ] as const;

  const LOAD_FAILURE_DOMAINS = [
    'agent.operations.failureDomain.configuration',
    'agent.operations.failureDomain.threads',
    ...THREAD_CONTEXT_FAILURE_DOMAINS,
  ] as const;

  const errorSlots = shallowRef<AgentSurfaceFailure<AgentSurfaceRetry>[]>([]);

  const currentError = computed(() => latestAgentSurfaceFailure(errorSlots.value));

  const error = computed(() => currentError.value?.message ?? '');

  const errorDomainKey = computed(() => currentError.value?.domainKey ?? '');

  const errorCode = computed(() => currentError.value?.code ?? '');

  const errorRetry = computed(() => currentError.value?.retry ?? null);

  let currentRunCheckpointsGeneration = 0;

  interface CachedThreadContext {
    entries: AgentLedgerEntryDto[];
    nextCursor: string | null;
    run: AgentRunViewDto | null;
    threadRuns: AgentRunViewDto[];
    approvalBatch: AgentApprovalBatchViewModel | null;
    reconciliationDetails: AgentRunReconciliationViewDto | null;
  }

  const THREAD_CONTEXT_CACHE_LIMIT = 12;

  const threadContextCache = new Map<string, CachedThreadContext>();

  const cacheCurrentThreadContext = (): void => {
    const threadId = currentThread.value?.id;
    if (!threadId || !threadContentReady.value) return;
    const snapshot: CachedThreadContext = {
      entries: [...entries.value],
      nextCursor: nextCursor.value,
      run: run.value,
      threadRuns: [...threadRuns.value],
      approvalBatch: approvalBatch.value,
      reconciliationDetails: reconciliationDetails.value,
    };
    threadContextCache.delete(threadId);
    threadContextCache.set(threadId, snapshot);
    while (threadContextCache.size > THREAD_CONTEXT_CACHE_LIMIT) {
      const oldest = threadContextCache.keys().next().value as string | undefined;
      if (!oldest) break;
      threadContextCache.delete(oldest);
    }
  };

  const restoreCachedThreadContext = (threadId: string): boolean => {
    const cached = threadContextCache.get(threadId);
    if (!cached) return false;
    threadContextCache.delete(threadId);
    threadContextCache.set(threadId, cached);
    entries.value = [...cached.entries];
    nextCursor.value = cached.nextCursor;
    run.value = cached.run;
    threadRuns.value = [...cached.threadRuns];
    approvalBatch.value = cached.approvalBatch;
    reconciliationDetails.value = cached.reconciliationDetails;
    return true;
  };

  const refreshCurrentCheckpoints = async (): Promise<void> => {
    const requestGeneration = ++currentRunCheckpointsGeneration;
    const runId = run.value?.id ?? null;
    if (!runId) {
      currentRunCheckpoints.value = [];
      return;
    }
    try {
      const checkpoints = await facade.listCheckpoints(runId);
      if (requestGeneration !== currentRunCheckpointsGeneration || run.value?.id !== runId) return;
      currentRunCheckpoints.value = checkpoints;
      clearError('agent.operations.failureDomain.checkpoints');
    } catch (cause) {
      if (requestGeneration !== currentRunCheckpointsGeneration || run.value?.id !== runId) return;
      currentRunCheckpoints.value = [];
      logger.warn({ err: cause, appId: props.appId, runId }, 'Agent UI failed to refresh current Run checkpoints');
      fail(cause, {
        domainKey: 'agent.operations.failureDomain.checkpoints',
        retry: () => void refreshCurrentCheckpoints(),
      });
    }
  };

  watch(
    () => run.value?.id,
    () => {
      void refreshCurrentCheckpoints();
    },
    { immediate: true },
  );

  const detailSubagents: Ref<AgentSubagentViewDto[]> = ref([]);

  const selectedSubagentId = ref<string | null>(null);

  const detailSubagentMessages = ref<AgentSubagentMessageDto[]>([]);

  const detailVisible = ref(false);

  const selectedModelKey = ref('');

  const selectedReasoningEffort = ref<AgentReasoningEffortDto | null>(
    agentSurfaceSession.restoreReasoningEffort(props.appId) ?? null,
  );

  const selectedApprovalMode = ref<AgentApprovalModeDto>(
    agentSurfaceSession.restoreApprovalMode(props.appId) ?? props.defaultApprovalMode,
  );

  const selectedExecutionMode = ref<AgentExecutionModeDto>(
    agentSurfaceSession.restoreExecutionMode(props.appId) ?? 'execute',
  );

  const taskRailVisible = ref(agentWindowManager.state.taskRailVisible);

  const threadDeleteArmedId = ref<string | null>(null);

  const deleteAllThreadsArmed = ref(false);

  const threadSidebarVisible = ref(agentWindowManager.state.threadSidebarVisible);

  const threadsOverlay = ref(false);

  const threadDrawerOpen = ref(false);

  const THREADS_OVERLAY_BREAKPOINT = 760;

  const threadSidebar = ref<InstanceType<typeof AgentThreadSidebar> | null>(null);

  watch(threadSidebarVisible, (visible) => agentWindowManager.setThreadSidebarVisible(visible));

  watch(taskRailVisible, (visible) => agentWindowManager.setTaskRailVisible(visible));

  const threadPageSize = ref(12);

  const streamingText = ref('');

  const streamingAttempt = ref<{ attemptId: string; attemptIndex: number } | null>(null);

  const resetStreamingPresentation = (): void => {
    streamingText.value = '';
    streamingAttempt.value = null;
  };

  const activateStreamingAttempt = (attemptId: string, attemptIndex: number): void => {
    const current = streamingAttempt.value;
    if (current?.attemptId === attemptId && current.attemptIndex === attemptIndex) return;
    streamingAttempt.value = { attemptId, attemptIndex };
    streamingText.value = '';
  };

  const busy = ref(false);

  const loading = ref(true);

  const selectingThread = ref(false);

  const threadContentReady = ref(false);

  const draft = ref(agentSurfaceSession.state(props.appId).draft);

  const commandResult = ref<ConversationCommandResult | null>(null);

  let threadSelectionGeneration = 0;

  let threadListRefreshGeneration = 0;

  let ledgerGeneration = 0;

  let approvalsGeneration = 0;

  let reconciliationGeneration = 0;

  let backgroundGeneration = 0;

  let detailApprovalGeneration = 0;

  let detailSubagentsGeneration = 0;

  let detailOpenGeneration = 0;

  let subagentMessagesGeneration = 0;

  let configurationGeneration = 0;

  let authorizationGeneration = 0;

  let surfaceDisposed = false;

  let threadDeleteArmTimer: number | null = null;

  let deleteAllThreadsArmTimer: number | null = null;

  const backgroundThreadStatuses = computed(() => {
    const statuses = new Map<string, AgentRunViewDto['status']>();
    for (const candidate of backgroundRuns.value) {
      if (!statuses.has(candidate.threadId)) statuses.set(candidate.threadId, candidate.status);
    }
    return statuses;
  });

  const threadStatus = (threadId: string): AgentRunViewDto['status'] | null => {
    if (currentThread.value?.id === threadId && run.value) return run.value.status;
    return backgroundThreadStatuses.value.get(threadId) ?? null;
  };

  const activeThreadCount = computed(
    () =>
      threads.value.filter((thread) => {
        const status = threadStatus(thread.id);
        return status !== null && isAgentRunNonTerminal(status);
      }).length,
  );

  const threadStatuses = computed<Record<string, AgentRunViewDto['status'] | null>>(() =>
    Object.fromEntries(threads.value.map((thread) => [thread.id, threadStatus(thread.id)])),
  );

  const threadTitles = computed<Record<string, string>>(() =>
    Object.fromEntries(
      threads.value.map((thread) => [thread.id, thread.title || t('agent.operations.untitledThread')]),
    ),
  );

  type ModelOption = {
    key: string;
    provider: AgentProviderViewDto;
    model: AgentProviderViewDto['models'][number];
    compatible: boolean;
    missingCapabilities: AgentModelCapabilityDto[];
  };

  const modelOptions = computed<ModelOption[]>(() => {
    const definition = definitions.value[0];
    return providers.value
      .filter((provider) => provider.enabled)
      .flatMap((provider) =>
        provider.models.map((model) => {
          const compatibility = definition?.modelCompatibility.find(
            (candidate) =>
              candidate.providerId === provider.id &&
              candidate.modelId === model.id &&
              candidate.configurationVersion === provider.version,
          );
          return {
            key: `${provider.id}\u0000${model.id}\u0000${provider.version}`,
            provider,
            model,
            compatible: compatibility?.compatible ?? false,
            missingCapabilities: compatibility?.missingCapabilities ?? [],
          };
        }),
      );
  });

  const providerSelection = computed(
    () =>
      modelOptions.value.find((candidate) => candidate.key === selectedModelKey.value && candidate.compatible) ??
      modelOptions.value.find((candidate) => candidate.compatible) ??
      null,
  );

  const modelCapabilityLabel = (capability: AgentModelCapabilityDto): string =>
    t(`agent.operations.modelCapability.${capability}`);

  const modelOptionHint = (option: ModelOption): string =>
    option.compatible
      ? option.provider.displayName
      : t('agent.operations.modelMissingCapabilities', {
          capabilities: option.missingCapabilities.map(modelCapabilityLabel).join(', '),
        });

  const modelSelectionLocked = computed(() => Boolean(run.value && isAgentRunNonTerminal(run.value.status)));

  const executionModeValue = computed<AgentExecutionModeDto>(() =>
    modelSelectionLocked.value && run.value ? run.value.definition.executionMode : selectedExecutionMode.value,
  );

  const setExecutionMode = (mode: AgentExecutionModeDto): void => {
    if (modelSelectionLocked.value) return;
    selectedExecutionMode.value = mode;
    agentSurfaceSession.setExecutionMode(props.appId, mode);
  };

  const approvalModeValue = computed<AgentApprovalModeDto>(() =>
    modelSelectionLocked.value && run.value ? run.value.definition.approvalMode : selectedApprovalMode.value,
  );

  const setApprovalMode = (mode: AgentApprovalModeDto): void => {
    if (modelSelectionLocked.value) return;
    selectedApprovalMode.value = mode;
    agentSurfaceSession.setApprovalMode(props.appId, mode);
  };

  const activeRunModel = computed(() => {
    const frozen = run.value?.definition.model;
    if (!frozen) return null;
    const provider = providers.value.find((candidate) => candidate.id === frozen.providerId);
    return provider?.models.find((candidate) => candidate.id === frozen.modelId) ?? null;
  });

  const reasoningModel = computed(() =>
    modelSelectionLocked.value ? activeRunModel.value : (providerSelection.value?.model ?? null),
  );

  const reasoningLevels = computed<AgentReasoningEffortDto[]>(() => reasoningModel.value?.reasoningEfforts ?? []);

  const reasoningCapabilityAvailable = computed(() => reasoningLevels.value.length > 0);

  const reasoningValue = computed<AgentReasoningEffortDto | null>(() =>
    modelSelectionLocked.value ? (run.value?.definition.reasoningEffort ?? null) : selectedReasoningEffort.value,
  );

  const activeReasoningIndex = computed(() => {
    const level = reasoningValue.value;
    if (!level) return 0;
    const idx = reasoningLevels.value.indexOf(level);
    return idx === -1 ? 0 : idx;
  });

  const isDraggingReasoning = ref(false);

  const dragThumbPercent = ref<number | null>(null);

  const thumbLeftPercent = computed(() => {
    if (isDraggingReasoning.value && dragThumbPercent.value !== null) {
      return dragThumbPercent.value;
    }
    const count = reasoningLevels.value.length;
    if (count <= 1) return 50;
    const ratio = activeReasoningIndex.value / (count - 1);
    return Math.round(5 + ratio * 90);
  });

  const trackFillPercent = computed(() => thumbLeftPercent.value);

  const isUltraOrMax = computed(() => {
    const current = reasoningValue.value;
    return current === 'max' || current === 'xhigh';
  });

  const currentReasoningDescription = computed(() => {
    const level = reasoningValue.value;
    if (!level) return t('agent.ui.reasoningDefault');
    return t(`agent.ui.reasoningDescriptions.${level}`);
  });

  const reasoningTrackRef = ref<HTMLElement | null>(null);

  const reasoningLevelLabel = (level: AgentReasoningEffortDto): string => t(`agent.ui.reasoningLevels.${level}`);

  const reasoningDisplayLabel = computed(() =>
    reasoningValue.value ? reasoningLevelLabel(reasoningValue.value) : t('agent.ui.reasoningDefaultShort'),
  );

  let draggingPointerId: number | null = null;

  const updateReasoningFromClientX = (clientX: number): void => {
    if (!reasoningTrackRef.value || reasoningLevels.value.length <= 1) return;
    const rect = reasoningTrackRef.value.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    dragThumbPercent.value = Math.round(5 + ratio * 90);
    const targetIdx = Math.round(ratio * (reasoningLevels.value.length - 1));
    const clampedIdx = Math.max(0, Math.min(targetIdx, reasoningLevels.value.length - 1));
    const effort = reasoningLevels.value[clampedIdx];
    if (effort && effort !== reasoningValue.value) {
      setReasoningEffort(effort);
    }
  };

  const onTrackPointerDown = (event: PointerEvent): void => {
    if (modelSelectionLocked.value || busy.value || !reasoningTrackRef.value || reasoningLevels.value.length <= 1)
      return;
    if (event.button !== 0) return;
    draggingPointerId = event.pointerId;
    isDraggingReasoning.value = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    updateReasoningFromClientX(event.clientX);
  };

  const onTrackPointerMove = (event: PointerEvent): void => {
    if (!isDraggingReasoning.value || draggingPointerId !== event.pointerId) return;
    updateReasoningFromClientX(event.clientX);
  };

  const onTrackPointerUp = (event: PointerEvent): void => {
    if (draggingPointerId !== event.pointerId) return;
    try {
      const target = event.currentTarget as HTMLElement;
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
    } catch {}
    draggingPointerId = null;
    isDraggingReasoning.value = false;
    dragThumbPercent.value = null;
  };

  const onTrackPointerCancel = (event: PointerEvent): void => {
    onTrackPointerUp(event);
  };

  const displayedConnectionIds = computed(() =>
    modelSelectionLocked.value && run.value ? run.value.definition.connectionIds : selectedConnectionIds.value,
  );

  watch(
    [modelSelectionLocked, () => connections.value.map((connection) => connection.id).join('\u0000')],
    () => {
      if (modelSelectionLocked.value) return;
      const available = connections.value.map((connection) => connection.id).sort((left, right) => left - right);
      if (!connectionSelectionExplicit.value) {
        selectedConnectionIds.value = available;
        return;
      }
      const availableIds = new Set(available);
      const next = selectedConnectionIds.value.filter((id) => availableIds.has(id));
      if (next.length !== selectedConnectionIds.value.length) {
        selectedConnectionIds.value = next;
        agentSurfaceSession.setConnectionIds(props.appId, next);
      }
    },
    { immediate: true },
  );

  const mutationLocked = computed(
    () =>
      busy.value ||
      selectingThread.value ||
      runtimeOperation.phase.value === 'conflict' ||
      runtimeOperation.phase.value === 'reconciling' ||
      run.value?.needsReconciliation === true,
  );

  const canSend = computed(() => {
    if (!currentThread.value || mutationLocked.value) return false;
    if (!appExecutable.value) {
      const submission = parseConversationSubmission(draft.value);
      return (
        submission.kind === 'invalid_command' || (submission.kind === 'command' && submission.command.kind === 'help')
      );
    }
    const submission = parseConversationSubmission(draft.value);
    if (submission.kind === 'invalid_command') return true;
    if (submission.kind === 'command') {
      if (submission.command.kind === 'help') return true;
      if (run.value) return true;
      return submission.command.kind === 'goal.set' ? Boolean(definitions.value[0] && providerSelection.value) : true;
    }
    if (run.value) {
      if (agentRunAcceptsInput(run.value.status)) return true;
      if (isAgentRunNonTerminal(run.value.status)) return false;
    }
    return Boolean(definitions.value[0] && providerSelection.value);
  });

  const explain = (cause: unknown): string => formatAgentApiError(cause, t('agent.operations.requestFailed'), t);

  const applyFailure = (
    message: string,
    code: string,
    options: { domainKey: string; retry?: () => void; retryLabelKey?: string },
  ): void => {
    const retry = options.retry
      ? { labelKey: options.retryLabelKey ?? 'agent.operations.retry', run: options.retry }
      : null;
    errorSlots.value = upsertAgentSurfaceFailure(errorSlots.value, {
      domainKey: options.domainKey,
      message,
      code: code === 'AGENT_REQUEST_FAILED' ? '' : code,
      retry,
    });
  };

  const fail = (cause: unknown, options: { domainKey: string; retry?: () => void; retryLabelKey?: string }): void => {
    applyFailure(explain(cause), toAgentApiError(cause).code, options);
  };

  const clearError = (domainKey: string): void => {
    errorSlots.value = clearAgentSurfaceFailure(errorSlots.value, domainKey);
  };

  const clearErrors = (domainKeys: readonly string[]): void => {
    errorSlots.value = clearAgentSurfaceFailures(errorSlots.value, domainKeys);
  };

  const clearCurrentError = (): void => {
    const domainKey = currentError.value?.domainKey;
    if (domainKey) clearError(domainKey);
  };

  const errorDomainLabel = computed(() => (errorDomainKey.value ? t(errorDomainKey.value) : ''));

  const errorRetryLabel = computed(() => (errorRetry.value ? t(errorRetry.value.labelKey) : ''));

  const retryFailedOperation = (): void => {
    const failure = currentError.value;
    if (!failure) return;
    clearError(failure.domainKey);
    failure.retry?.run();
  };

  const rememberThreadRun = (candidate: AgentRunViewDto): void => {
    if (currentThread.value?.id !== candidate.threadId) return;
    threadRuns.value = [candidate, ...threadRuns.value.filter((item) => item.id !== candidate.id)].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
  };

  const setModelSelection = (key: string): void => {
    if (modelSelectionLocked.value) return;
    const option = modelOptions.value.find((candidate) => candidate.key === key);
    if (!option?.compatible) return;
    selectedModelKey.value = option.key;
    agentSurfaceSession.setModelKey(props.appId, option.key);
    const nextEffort = option.model.defaultReasoningEffort ?? null;
    selectedReasoningEffort.value = nextEffort;
    agentSurfaceSession.setReasoningEffort(props.appId, nextEffort ?? undefined);
  };

  const setReasoningEffort = (effort: AgentReasoningEffortDto): void => {
    if (modelSelectionLocked.value || !reasoningLevels.value.includes(effort)) return;
    selectedReasoningEffort.value = effort;
    agentSurfaceSession.setReasoningEffort(props.appId, effort);
  };

  const toggleConnectionSelection = (connectionId: number, checked: boolean): void => {
    if (modelSelectionLocked.value) return;
    const next = new Set(selectedConnectionIds.value);
    if (checked) next.add(connectionId);
    else next.delete(connectionId);
    selectedConnectionIds.value = [...next].sort((left, right) => left - right);
    connectionSelectionExplicit.value = true;
    agentSurfaceSession.setConnectionIds(props.appId, selectedConnectionIds.value);
  };

  const connectionSelectionState = computed<'off' | 'mixed' | 'on'>(() => {
    const selectedCount = displayedConnectionIds.value.length;
    if (selectedCount === 0) return 'off';
    if (selectedCount === connections.value.length) return 'on';
    return 'mixed';
  });

  const setAllConnectionSelections = (enabled: boolean): void => {
    if (modelSelectionLocked.value) return;
    selectedConnectionIds.value = enabled
      ? connections.value.map((connection) => connection.id).sort((left, right) => left - right)
      : [];
    connectionSelectionExplicit.value = true;
    agentSurfaceSession.setConnectionIds(props.appId, selectedConnectionIds.value);
  };

  const toggleAllConnectionSelections = (): void => {
    setAllConnectionSelections(connectionSelectionState.value !== 'on');
  };

  const refreshLedger = async (): Promise<void> => {
    const thread = currentThread.value;
    if (!thread) return;
    const requestGeneration = ++ledgerGeneration;
    const page = await facade.readLedger(thread.id);
    if (requestGeneration !== ledgerGeneration || currentThread.value?.id !== thread.id) return;
    entries.value = page.items;
    nextCursor.value = page.nextCursor;
  };

  const refreshReconciliation = async (runId?: string): Promise<void> => {
    const requestGeneration = ++reconciliationGeneration;
    const targetRun = run.value;
    if (!runId || !targetRun || targetRun.id !== runId || !targetRun.needsReconciliation) {
      reconciliationDetails.value = null;
      return;
    }
    try {
      const details = await facade.getReconciliation(runId);
      if (requestGeneration !== reconciliationGeneration || run.value?.id !== runId) return;
      reconciliationDetails.value = details.required ? details : null;
      clearError('agent.operations.failureDomain.run');
    } catch (cause) {
      if (requestGeneration !== reconciliationGeneration || run.value?.id !== runId) return;
      reconciliationDetails.value = null;
      fail(cause, {
        domainKey: 'agent.operations.failureDomain.run',
        retry: () => void refreshReconciliation(runId),
      });
    }
  };

  const refreshRun = async (
    runId: string,
    minimumEventCursor = 0,
    reportFailure = true,
  ): Promise<AgentRunSnapshotDto | null> => {
    try {
      const snapshot = await facade.getRun(runId, minimumEventCursor);
      if (currentThread.value?.id !== snapshot.threadId || (run.value !== null && run.value.id !== runId)) return null;
      run.value = snapshot;
      rememberThreadRun(snapshot);
      clearError('agent.operations.failureDomain.run');
      if (snapshot.needsReconciliation) {
        runtimeOperation.markReconciling('RECONCILIATION_REQUIRED', t('agent.operations.reconciliationRequired'));
        await refreshReconciliation(snapshot.id);
      } else {
        reconciliationDetails.value = null;
        if (runtimeOperation.phase.value === 'reconciling') runtimeOperation.succeed();
      }
      return snapshot;
    } catch (cause) {
      logger.warn(
        { err: cause, appId: props.appId, runId, minimumEventCursor },
        'Agent UI failed to refresh authoritative Run state',
      );
      if (reportFailure) {
        fail(cause, {
          domainKey: 'agent.operations.failureDomain.run',
          retry: () => void refreshRun(runId, minimumEventCursor),
        });
      }
      return null;
    }
  };

  const refreshApprovals = async (runId?: string): Promise<void> => {
    const requestGeneration = ++approvalsGeneration;
    if (!runId) {
      approvalBatch.value = null;
      return;
    }
    try {
      const next = await facade.listApprovals(runId);
      if (requestGeneration !== approvalsGeneration || run.value?.id !== runId) return;
      approvalBatch.value = next;
      clearError('agent.operations.failureDomain.approvals');
    } catch {
      if (requestGeneration !== approvalsGeneration || run.value?.id !== runId) return;
    }
  };

  const refreshBackgroundRuns = async (): Promise<void> => {
    const requestGeneration = ++backgroundGeneration;
    const selectedThreadId = currentThread.value?.id ?? null;
    const page = await facade.listRuns();
    if (requestGeneration !== backgroundGeneration || (currentThread.value?.id ?? null) !== selectedThreadId) return;
    backgroundRuns.value = page.items.filter(
      (candidate) => isAgentRunNonTerminal(candidate.status) && candidate.threadId !== selectedThreadId,
    );
  };

  const recoverRuntimeFailure = async (cause: unknown, runId?: string): Promise<void> => {
    const decision = runtimeOperation.fail(cause);
    fail(cause, {
      domainKey: 'agent.operations.failureDomain.mutation',
      retryLabelKey: 'agent.operations.resync',
      retry: () => {
        const targetRunId = runId ?? run.value?.id;
        if (!targetRunId) return;
        void (async () => {
          await refreshRun(targetRunId, 0, false);
          await Promise.all([refreshApprovals(targetRunId), refreshLedger(), refreshBackgroundRuns()]);
        })();
      },
    });
    if (!decision.refreshAuthoritativeState) return;

    const targetRunId = runId ?? run.value?.id;
    if (!targetRunId || run.value?.id !== targetRunId) return;
    const next = await refreshRun(targetRunId, 0, false);
    await Promise.all([refreshApprovals(targetRunId), refreshLedger(), refreshBackgroundRuns()]);
    if (next?.needsReconciliation || decision.phase === 'reconciling') {
      runtimeOperation.markReconciling('RECONCILIATION_REQUIRED', t('agent.operations.reconciliationRequired'));
      return;
    }
    if (decision.phase === 'conflict' && next) runtimeOperation.succeed();
  };

  const reportPostCommitSyncFailure = (cause: unknown, options: { domainKey: string; retry: () => void }): void => {
    logger.warn({ err: cause, appId: props.appId }, 'Agent UI post-commit resync failed');
    applyFailure(t('agent.operations.postCommitSyncFailed'), '', {
      domainKey: options.domainKey,
      retryLabelKey: 'agent.operations.resync',
      retry: options.retry,
    });
  };

  const postCommitSync = async (
    action: () => Promise<void>,
    options: { domainKey: string; retry: () => void },
  ): Promise<void> => {
    try {
      await action();
      clearError(options.domainKey);
    } catch (cause) {
      reportPostCommitSyncFailure(cause, options);
    }
  };

  const resolveReconciliation = async (note: string): Promise<void> => {
    const currentRun = run.value;
    const details = reconciliationDetails.value;
    const normalizedNote = note.trim();
    if (!currentRun?.needsReconciliation || !details?.required || !normalizedNote || reconciliationBusy.value) return;

    reconciliationBusy.value = true;
    clearError('agent.operations.failureDomain.mutation');
    try {
      const resolved = await facade.resolveReconciliation(currentRun, details, normalizedNote);
      if (run.value?.id !== resolved.id) return;
      run.value = resolved;
      rememberThreadRun(resolved);
      reconciliationDetails.value = null;
      runtimeOperation.succeed();
      await Promise.all([refreshLedger(), refreshApprovals(resolved.id), refreshBackgroundRuns()]);
    } catch (cause) {
      await recoverRuntimeFailure(cause, currentRun.id);
    } finally {
      reconciliationBusy.value = false;
    }
  };

  const stopRunStream = (): void => {
    facade.selectRun(null);
    resetStreamingPresentation();
  };

  const startRunStream = (initial: AgentRunViewDto): void => {
    resetStreamingPresentation();
    clearError('agent.operations.failureDomain.stream');
    logger.debug(
      {
        appId: props.appId,
        runId: initial.id,
        threadId: initial.threadId,
        status: initial.status,
        eventCursor: initial.eventCursor,
        modelId: initial.definition.model.modelId,
        reasoningEffort: initial.definition.reasoningEffort ?? null,
      },
      'Agent UI run stream starting',
    );
    facade.selectRun(initial, {
      onEvent: async (event, signal) => {
        if (signal.aborted) return;
        if (event.type !== 'message.delta' && event.type !== 'tool.delta') {
          logger.debug(
            {
              appId: props.appId,
              runId: initial.id,
              threadId: initial.threadId,
              eventType: event.type,
              eventId: event.id ?? null,
            },
            'Agent UI run event received',
          );
        }
        if (event.type === 'transport.disconnected') {
          logger.debug(
            { appId: props.appId, runId: initial.id, threadId: initial.threadId },
            'Agent UI retaining partial stream presentation across transport reconnect',
          );
        }
        if (event.type === 'model.retrying') {
          if (streamingAttempt.value?.attemptId === event.payload.previousAttemptId) {
            activateStreamingAttempt(event.payload.attemptId, event.payload.attemptIndex);
          }
        }
        if (event.type === 'message.delta') {
          if (!event.payload.delegationId) {
            activateStreamingAttempt(event.payload.attemptId, event.payload.attemptIndex);
            streamingText.value += event.payload.text;
          }
          return;
        }
        if (event.type === 'tool.delta') {
          if (!event.payload.delegationId) {
            activateStreamingAttempt(event.payload.attemptId, event.payload.attemptIndex);
          }
          return;
        }
        if (event.type === 'message.final') resetStreamingPresentation();
        const recoveryEvent = event.type === 'run.recovery_continued' || event.type === 'run.recovery_failed';
        if (event.type === 'run.recovery_failed') {
          applyFailure(t('agent.operations.restartRecoveryFailed', { reasons: event.payload.reasons.join(', ') }), '', {
            domainKey: 'agent.operations.failureDomain.run',
            retry: () => void refreshRun(initial.id, 0),
          });
        }
        const durableCursor = event.id === undefined ? 0 : Number(event.id);
        const next = await refreshRun(
          initial.id,
          Number.isSafeInteger(durableCursor) && durableCursor >= 0 ? durableCursor : 0,
        );
        if (signal.aborted) return;
        await Promise.all([
          refreshLedger(),
          refreshApprovals(initial.id),
          refreshBackgroundRuns(),
          ...(recoveryEvent
            ? [
                facade.listCheckpoints(initial.id).then((checkpoints) => {
                  if (run.value?.id === initial.id) currentRunCheckpoints.value = checkpoints;
                  if (detailVisible.value && detailSnapshot.value?.id === initial.id) {
                    detailCheckpoints.value = checkpoints;
                  }
                }),
              ]
            : []),
          ...(detailVisible.value && detailSnapshot.value?.id === initial.id
            ? [refreshDetailSubagents(initial.id), refreshDetailApprovalBatch(initial.id)]
            : []),
        ]);
        if (signal.aborted) return;
        if (!next || !isAgentRunNonTerminal(next.status)) {
          resetStreamingPresentation();
          facade.selectRun(null);
        }
      },
      onError: (cause) => {
        logger.warn(
          { appId: props.appId, runId: initial.id, threadId: initial.threadId, err: cause },
          'Agent UI run stream failed',
        );
        fail(cause, {
          domainKey: 'agent.operations.failureDomain.stream',
          retry: () => void refreshRun(initial.id, 0, false),
        });
      },
    });
  };

  const selectThread = async (thread: AgentThreadViewDto, force = false): Promise<void> => {
    threadDrawerOpen.value = false;
    if (!force && currentThread.value?.id === thread.id) return;
    cacheCurrentThreadContext();
    const selectionGeneration = ++threadSelectionGeneration;
    stopRunStream();
    currentThread.value = thread;
    currentRunCheckpoints.value = [];
    const restoredFromCache = restoreCachedThreadContext(thread.id);
    if (!restoredFromCache) {
      entries.value = [];
      run.value = null;
      reconciliationDetails.value = null;
      threadRuns.value = [];
      approvalBatch.value = null;
      nextCursor.value = null;
    }
    threadContentReady.value = restoredFromCache;
    clearErrors(THREAD_CONTEXT_FAILURE_DOMAINS);
    runtimeOperation.succeed();
    commandResult.value = null;
    agentSurfaceSession.setThread(props.appId, thread.id);
    selectingThread.value = true;
    try {
      const [, runs] = await Promise.all([refreshLedger(), facade.listRuns(thread.id)]);
      if (selectionGeneration !== threadSelectionGeneration || currentThread.value?.id !== thread.id) return;
      threadRuns.value = runs.items;
      const selectedRun =
        runs.items.find((candidate) => isAgentRunNonTerminal(candidate.status)) ?? runs.items[0] ?? null;
      run.value = selectedRun;
      if (selectedRun) rememberThreadRun(selectedRun);
      // The transcript and run list are enough to paint the conversation. Do not keep the
      // full-screen loader up while snapshot/approval/background metadata catches up.
      threadContentReady.value = true;

      const approvalPromise = refreshApprovals(selectedRun?.id);
      const backgroundPromise = refreshBackgroundRuns().catch((cause) => {
        logger.debug(
          { err: cause, appId: props.appId, threadId: thread.id },
          'Agent UI background Run refresh deferred',
        );
      });
      const active = selectedRun ? await facade.getRun(selectedRun.id) : null;
      if (selectionGeneration !== threadSelectionGeneration || currentThread.value?.id !== thread.id) return;
      run.value = active;
      if (active) rememberThreadRun(active);
      let reconciliationPromise: Promise<void>;
      if (active?.needsReconciliation) {
        runtimeOperation.markReconciling('RECONCILIATION_REQUIRED', t('agent.operations.reconciliationRequired'));
        reconciliationPromise = refreshReconciliation(active.id);
      } else {
        reconciliationDetails.value = null;
        reconciliationPromise = Promise.resolve();
      }
      await Promise.all([approvalPromise, reconciliationPromise]);
      if (selectionGeneration !== threadSelectionGeneration || currentThread.value?.id !== thread.id) return;
      if (active && isAgentRunNonTerminal(active.status)) startRunStream(active);
      void backgroundPromise;
    } catch (cause) {
      if (selectionGeneration === threadSelectionGeneration) {
        fail(cause, {
          domainKey: 'agent.operations.failureDomain.transcript',
          retry: () => void selectThread(thread, true),
        });
      }
    } finally {
      if (selectionGeneration === threadSelectionGeneration) selectingThread.value = false;
    }
  };

  const invalidateThreadPagination = (): number => {
    threadListLoadingMore.value = false;
    return ++threadListRefreshGeneration;
  };

  const refreshThreadListFromHost = async (): Promise<void> => {
    const requestGeneration = invalidateThreadPagination();
    try {
      const requestedLimit = Math.min(THREAD_PAGE_MAX, Math.max(threadPageSize.value, threads.value.length));
      const page = await facade.listThreads(undefined, requestedLimit);
      if (requestGeneration !== threadListRefreshGeneration) return;
      threads.value = page.items;
      threadNextCursor.value = page.nextCursor;
      if (currentThread.value) {
        currentThread.value = page.items.find((thread) => thread.id === currentThread.value?.id) ?? currentThread.value;
      }
    } catch {
      // A later durable host event or normal surface reload will retry authoritative state.
    }
  };

  const onThreadChanged = (payload: Record<string, unknown>): void => {
    if (payload.appId !== props.appId) return;
    void refreshThreadListFromHost();
  };

  const createThread = async (title?: string, idempotencyKey = crypto.randomUUID()): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    clearError('agent.operations.failureDomain.threads');
    try {
      const normalizedTitle = title?.trim();
      const thread = await facade.createThread(normalizedTitle || undefined, idempotencyKey);
      invalidateThreadPagination();
      threads.value = [thread, ...threads.value.filter((item) => item.id !== thread.id)];
      threadSidebar.value?.resetScroll();
      await selectThread(thread);
    } catch (cause) {
      fail(cause, {
        domainKey: 'agent.operations.failureDomain.threads',
        retry: () => void createThread(title, idempotencyKey),
      });
    } finally {
      busy.value = false;
    }
  };

  const beginThreadCreation = async (): Promise<void> => {
    await createThread();
    await nextTick();
    document.getElementById('agent-composer')?.focus();
  };

  const loadMoreThreads = async (): Promise<void> => {
    const cursor = threadNextCursor.value;
    if (!cursor || threadListLoadingMore.value) return;
    const requestGeneration = threadListRefreshGeneration;
    threadListLoadingMore.value = true;
    try {
      const page = await facade.listThreads(cursor, threadPageSize.value);
      if (requestGeneration !== threadListRefreshGeneration || threadNextCursor.value !== cursor) return;
      const known = new Set(threads.value.map((thread) => thread.id));
      threads.value = [...threads.value, ...page.items.filter((thread) => !known.has(thread.id))];
      threadNextCursor.value = page.nextCursor;
      clearError('agent.operations.failureDomain.threads');
    } catch (cause) {
      if (requestGeneration !== threadListRefreshGeneration || threadNextCursor.value !== cursor) return;
      fail(cause, {
        domainKey: 'agent.operations.failureDomain.threads',
        retry: () => void loadMoreThreads(),
      });
    } finally {
      if (requestGeneration === threadListRefreshGeneration) threadListLoadingMore.value = false;
    }
  };

  const loadRunConfiguration = async (): Promise<void> => {
    const requestGeneration = ++configurationGeneration;
    const authorizationRequestGeneration = ++authorizationGeneration;
    try {
      const [nextDefinitions, nextProviders, settings, , nextDenylist] = await Promise.all([
        facade.definitions(),
        facade.providers(),
        facade.settings(),
        connectionsStore.revalidate(0),
        agentApi.targetDenylist(),
      ]);
      if (surfaceDisposed || requestGeneration !== configurationGeneration) return;

      definitions.value = nextDefinitions;
      providers.value = nextProviders;
      settingsView.value = settings;
      if (authorizationRequestGeneration === authorizationGeneration) targetDenylist.value = nextDenylist;

      const restoredModelKey = agentSurfaceSession.restoreModelKey(props.appId);
      const restoredModel = modelOptions.value.find(
        (candidate) => candidate.key === restoredModelKey && candidate.compatible,
      );
      const preferredModel = modelOptions.value.find(
        (candidate) =>
          candidate.compatible &&
          candidate.provider.id === settings.effectiveSettings.model.defaultProviderId &&
          candidate.model.id === settings.effectiveSettings.model.defaultModelId,
      );
      const selectedModel =
        restoredModel ?? preferredModel ?? modelOptions.value.find((candidate) => candidate.compatible) ?? null;
      selectedModelKey.value = selectedModel?.key ?? '';
      agentSurfaceSession.setModelKey(props.appId, selectedModel?.key);
      const restoredReasoningEffort = agentSurfaceSession.restoreReasoningEffort(props.appId);
      const allowedReasoningEfforts = selectedModel?.model.reasoningEfforts ?? [];
      const initialReasoningEffort =
        restoredReasoningEffort && allowedReasoningEfforts.includes(restoredReasoningEffort)
          ? restoredReasoningEffort
          : (selectedModel?.model.defaultReasoningEffort ?? null);
      selectedReasoningEffort.value = initialReasoningEffort;
      agentSurfaceSession.setReasoningEffort(props.appId, initialReasoningEffort ?? undefined);
      hardLimits.value = settings.hardLimits;
      clearError('agent.operations.failureDomain.configuration');
    } catch (cause) {
      if (surfaceDisposed || requestGeneration !== configurationGeneration) return;
      throw cause;
    }
  };

  const load = async (): Promise<void> => {
    loading.value = true;
    clearErrors(LOAD_FAILURE_DOMAINS);
    const configurationPromise = loadRunConfiguration().catch((cause) => {
      fail(cause, {
        domainKey: 'agent.operations.failureDomain.configuration',
        retry: () => void loadRunConfiguration(),
      });
    });
    try {
      invalidateThreadPagination();
      const threadPage = await facade.listThreads(undefined, threadPageSize.value);
      threads.value = threadPage.items;
      threadNextCursor.value = threadPage.nextCursor;
      const restored = agentSurfaceSession.restoreThread(props.appId);
      const selected = threads.value.find((thread) => thread.id === restored) ?? threads.value[0];
      if (selected) await selectThread(selected);
      else await createThread();
    } catch (cause) {
      fail(cause, {
        domainKey: 'agent.operations.failureDomain.threads',
        retry: () => void load(),
      });
    } finally {
      loading.value = false;
    }
    void configurationPromise;
  };

  const beginRuntimeMutation = (): boolean => {
    if (mutationLocked.value) return false;
    busy.value = true;
    runtimeOperation.beginMutation();
    clearError('agent.operations.failureDomain.mutation');
    return true;
  };

  const finishRuntimeMutation = (): void => {
    busy.value = false;
  };

  const resolveArtifactRefs = async (
    artifacts: AgentArtifactRefDto[],
    activeRun?: AgentRunViewDto,
  ): Promise<string[]> => {
    const thread = currentThread.value;
    if (!thread) throw new Error('NOT_FOUND');
    for (const artifact of artifacts) {
      if (artifact.appId === props.appId) continue;
      await agentApi.attachArtifact(artifact, {
        targetAppId: props.appId,
        threadId: thread.id,
        ...(activeRun ? { runId: activeRun.id } : {}),
      });
    }
    return artifacts.map((artifact) => artifact.id);
  };

  let pendingRunCreateIdentity: { fingerprint: string; idempotencyKey: string } | null = null;

  const runCreateIdempotencyKey = (fields: Parameters<typeof facade.createRun>[0]): string => {
    const fingerprint = JSON.stringify(fields);
    if (!pendingRunCreateIdentity || pendingRunCreateIdentity.fingerprint !== fingerprint) {
      pendingRunCreateIdentity = { fingerprint, idempotencyKey: crypto.randomUUID() };
    }
    return pendingRunCreateIdentity.idempotencyKey;
  };

  const createNewRun = async (
    text: string,
    selectedArtifacts: AgentArtifactRefDto[] = [],
    initialGoal?: string,
  ): Promise<AgentRunViewDto> => {
    const thread = currentThread.value;
    const selection = providerSelection.value;
    const definition = definitions.value[0];
    if (!thread) throw new Error('NOT_FOUND');
    if (!selection || !definition) throw new Error('AGENT_PROVIDER_REQUIRED');
    const artifactRefs = await resolveArtifactRefs(selectedArtifacts);
    logger.debug(
      {
        appId: props.appId,
        threadId: thread.id,
        providerId: selection.provider.id,
        modelId: selection.model.id,
        reasoningEffort: selectedReasoningEffort.value,
        approvalMode: selectedApprovalMode.value,
        executionMode: selectedExecutionMode.value,
        inputBytes: new TextEncoder().encode(text).byteLength,
        artifactCount: artifactRefs.length,
        connectionCount: selectedConnectionIds.value.length,
      },
      'Agent UI creating run',
    );
    const plannedFromRunId =
      selectedExecutionMode.value === 'execute' &&
      run.value &&
      ['completed', 'completed_unverified'].includes(run.value.status) &&
      run.value.definition.executionMode === 'plan' &&
      run.value.plan.items.length > 0
        ? run.value.id
        : undefined;
    const fields: Parameters<typeof facade.createRun>[0] = {
      threadId: thread.id,
      input: { text, artifactRefs },
      agentDefinitionId: definition.id,
      model: {
        providerId: selection.provider.id,
        modelId: selection.model.id,
        configurationVersion: selection.provider.version,
      },
      ...(selectedReasoningEffort.value === null ? {} : { reasoningEffort: selectedReasoningEffort.value }),
      approvalMode: selectedApprovalMode.value,
      executionMode: selectedExecutionMode.value,
      ...(plannedFromRunId ? { plannedFromRunId } : {}),
      connectionIds: selectedConnectionIds.value,
      ...(initialGoal ? { initialGoal } : {}),
    };
    const idempotencyKey = runCreateIdempotencyKey(fields);
    const created = await facade.createRun(fields, idempotencyKey);
    if (pendingRunCreateIdentity?.idempotencyKey === idempotencyKey) pendingRunCreateIdentity = null;
    run.value = created;
    logger.info(
      {
        appId: props.appId,
        runId: created.id,
        threadId: created.threadId,
        status: created.status,
        eventCursor: created.eventCursor,
        modelId: created.definition.model.modelId,
        reasoningEffort: created.definition.reasoningEffort ?? null,
        approvalMode: created.definition.approvalMode,
        executionMode: created.definition.executionMode,
        parentRunId: created.parentRunId,
      },
      'Agent UI run created',
    );
    rememberThreadRun(created);
    clearComposer(true);
    await refreshLedger();
    await Promise.all([refreshApprovals(created.id), refreshBackgroundRuns()]);
    startRunStream(created);
    return created;
  };

  const clearComposer = (clearAttachments = false): void => {
    draft.value = '';
    agentSurfaceSession.setDraft(props.appId, '');
    if (clearAttachments) attachments.value = [];
  };

  const commandError = (title: string, message: string): void => {
    commandResult.value = { title, lines: [message], tone: 'error' };
  };

  const isRunVersionConflict = (cause: unknown): boolean => {
    const error = toAgentApiError(cause);
    if (error.status !== 409 || error.code !== 'STATE_CONFLICT') return false;
    if (!error.details || typeof error.details !== 'object' || Array.isArray(error.details)) return false;
    return (error.details as { field?: unknown }).field === 'expectedVersion';
  };

  const adoptCommandRun = (candidate: AgentRunViewDto): void => {
    if (currentThread.value?.id !== candidate.threadId || run.value?.id !== candidate.id) return;
    run.value = candidate;
    rememberThreadRun(candidate);
  };

  const executeSlashCommand = createConversationCommandExecutor({
    t: (key, values) => (values ? t(key, values) : t(key)),
    getRun: () => run.value,
    isActiveRun: (candidate) => agentRunAcceptsInput(candidate.status),
    beginMutation: beginRuntimeMutation,
    finishMutation: finishRuntimeMutation,
    succeedMutation: runtimeOperation.succeed,
    recoverFailure: recoverRuntimeFailure,
    setResult: (result) => {
      commandResult.value = result;
    },
    clearComposer: () => clearComposer(),
    createGoalRun: (text) => createNewRun(text, [], text),
    getRunSnapshot: (runId) => facade.getRun(runId),
    setGoal: (candidate, text) => facade.setGoal(candidate, text),
    pendingInputs: (runId) => facade.pendingInputs(runId),
    mutatePendingInput: (candidate, action, inputId, beforeInputId) =>
      facade.mutatePendingInput(candidate, action, inputId, beforeInputId),
    adoptRun: adoptCommandRun,
    refreshBackgroundRuns,
    interruptAndRefresh: async (candidate, text) => {
      await facade.interrupt(candidate, text);
      await refreshLedger();
      const next = await refreshRun(candidate.id);
      await Promise.all([refreshApprovals(candidate.id), refreshBackgroundRuns()]);
      if (next) startRunStream(next);
    },
    cancelAndRefresh: async (candidate) => {
      run.value = await facade.cancelRun(candidate);
      rememberThreadRun(run.value);
      await Promise.all([refreshLedger(), refreshApprovals(candidate.id), refreshBackgroundRuns()]);
    },
  });

  const send = async (text: string, selectedArtifacts: AgentArtifactRefDto[]): Promise<void> => {
    const submission = parseConversationSubmission(text);
    if (submission.kind === 'invalid_command') {
      const reasonKey =
        submission.reason === 'unknown'
          ? 'unknown'
          : submission.reason === 'missing_argument'
            ? 'missingArgument'
            : 'unexpectedArgument';
      commandError(
        t('agent.conversation.commands.errorTitle'),
        t(`agent.conversation.commands.${reasonKey}`, { command: submission.commandName }),
      );
      return;
    }
    if (!appExecutable.value && !(submission.kind === 'command' && submission.command.kind === 'help')) return;
    if (submission.kind === 'command') {
      await executeSlashCommand(submission.command, selectedArtifacts);
      return;
    }
    commandResult.value = null;
    if (!currentThread.value || !beginRuntimeMutation()) return;
    try {
      const active = run.value;
      if (active && isAgentRunNonTerminal(active.status) && !agentRunAcceptsInput(active.status)) {
        runtimeOperation.succeed();
        return;
      }
      if (active && agentRunAcceptsInput(active.status)) {
        const artifactRefs = await resolveArtifactRefs(selectedArtifacts, active);
        const idempotencyKey = crypto.randomUUID();
        try {
          await facade.appendInput(active, submission.text, artifactRefs, idempotencyKey);
        } catch (cause) {
          if (!isRunVersionConflict(cause)) throw cause;
          const refreshed = await facade.getRun(active.id);
          if (currentThread.value?.id !== refreshed.threadId) throw cause;
          run.value = refreshed;
          rememberThreadRun(refreshed);
          if (!isAgentRunNonTerminal(refreshed.status)) {
            await createNewRun(submission.text, selectedArtifacts);
            runtimeOperation.succeed();
            return;
          }
          await facade.appendInput(refreshed, submission.text, artifactRefs, crypto.randomUUID());
        }
        clearComposer(true);
        await refreshLedger();
        const next = await refreshRun(active.id);
        await Promise.all([refreshApprovals(active.id), refreshBackgroundRuns()]);
        if (next) startRunStream(next);
        runtimeOperation.succeed();
        return;
      }
      await createNewRun(submission.text, selectedArtifacts);
      runtimeOperation.succeed();
    } catch (cause) {
      await recoverRuntimeFailure(cause, run.value?.id);
    } finally {
      finishRuntimeMutation();
    }
  };

  const cancel = async (): Promise<void> => {
    if (!run.value || !beginRuntimeMutation()) return;
    const runId = run.value.id;
    try {
      run.value = await facade.cancelRun(run.value);
      rememberThreadRun(run.value);
      runtimeOperation.succeed();
      await postCommitSync(
        () => Promise.all([refreshLedger(), refreshApprovals(runId), refreshBackgroundRuns()]).then(() => undefined),
        {
          domainKey: 'agent.operations.failureDomain.run',
          retry: () => void Promise.all([refreshLedger(), refreshApprovals(runId), refreshBackgroundRuns()]),
        },
      );
    } catch (cause) {
      await recoverRuntimeFailure(cause, runId);
    } finally {
      finishRuntimeMutation();
    }
  };

  const increaseBudget = async (increase: Parameters<typeof facade.increaseBudget>[1]): Promise<void> => {
    if (!run.value || !beginRuntimeMutation()) return;
    const runId = run.value.id;
    try {
      run.value = await facade.increaseBudget(run.value, increase);
      rememberThreadRun(run.value);
      if (run.value && isAgentRunNonTerminal(run.value.status)) startRunStream(run.value);
      runtimeOperation.succeed();
      await postCommitSync(
        () => Promise.all([refreshLedger(), refreshApprovals(runId), refreshBackgroundRuns()]).then(() => undefined),
        {
          domainKey: 'agent.operations.failureDomain.run',
          retry: () => void Promise.all([refreshLedger(), refreshApprovals(runId), refreshBackgroundRuns()]),
        },
      );
    } catch (cause) {
      await recoverRuntimeFailure(cause, runId);
    } finally {
      finishRuntimeMutation();
    }
  };

  const resolveApproval = async (
    approval: AgentApprovalViewDto,
    decision: 'approved' | 'denied',
    feedback?: string,
  ): Promise<void> => {
    if (approval.status !== 'requested' || !beginRuntimeMutation()) return;
    try {
      await facade.resolveApproval(approval, decision, feedback);
      runtimeOperation.succeed();
      await postCommitSync(
        async () => {
          const next = await refreshRun(approval.runId, 0, false);
          if (!next) throw new Error('AGENT_POST_COMMIT_RESYNC_FAILED');
          await Promise.all([
            refreshApprovals(approval.runId),
            refreshLedger(),
            refreshBackgroundRuns(),
            ...(detailVisible.value && detailSnapshot.value?.id === approval.runId
              ? [refreshDetailApprovalBatch(approval.runId)]
              : []),
          ]);
          if (isAgentRunNonTerminal(next.status)) startRunStream(next);
        },
        {
          domainKey: 'agent.operations.failureDomain.approvals',
          retry: () => void refreshRun(approval.runId),
        },
      );
    } catch (cause) {
      await recoverRuntimeFailure(cause, approval.runId);
    } finally {
      finishRuntimeMutation();
    }
  };

  const refreshDetailApprovalBatch = async (runId: string): Promise<void> => {
    const requestGeneration = ++detailApprovalGeneration;
    try {
      const [next, snapshot] = await Promise.all([facade.listApprovals(runId), facade.getRun(runId)]);
      if (requestGeneration !== detailApprovalGeneration || !detailVisible.value || detailSnapshot.value?.id !== runId)
        return;
      detailApprovalBatch.value = next;
      detailSnapshot.value = snapshot;
    } catch {
      // Detail refresh is best-effort; authoritative current-run refresh still drives mutation state.
    }
  };

  const refreshDetailSubagents = async (runId: string): Promise<void> => {
    const requestGeneration = ++detailSubagentsGeneration;
    const page = await facade.listSubagents(runId);
    if (requestGeneration !== detailSubagentsGeneration || detailSnapshot.value?.id !== runId) return;
    detailSubagents.value = page.items;
    const selected = detailSubagents.value.find((item) => item.id === selectedSubagentId.value) ?? null;
    if (!selected) {
      subagentMessagesGeneration += 1;
      selectedSubagentId.value = null;
      detailSubagentMessages.value = [];
    }
  };

  const selectSubagent = async (delegation: AgentSubagentViewDto): Promise<void> => {
    const requestGeneration = ++subagentMessagesGeneration;
    selectedSubagentId.value = delegation.id;
    const page = await facade.listSubagentMessages(delegation.runId, delegation.id);
    if (
      requestGeneration !== subagentMessagesGeneration ||
      selectedSubagentId.value !== delegation.id ||
      detailSnapshot.value?.id !== delegation.runId
    )
      return;
    detailSubagentMessages.value = page.items;
  };

  const cancelSubagent = async (delegation: AgentSubagentViewDto): Promise<void> => {
    if (!beginRuntimeMutation()) return;
    try {
      await facade.cancelSubagent(delegation.runId, delegation);
      await refreshDetailSubagents(delegation.runId);
      if (selectedSubagentId.value === delegation.id) await selectSubagent(delegation);
      runtimeOperation.succeed();
    } catch (cause) {
      const decision = runtimeOperation.fail(cause);
      fail(cause, {
        domainKey: 'agent.operations.failureDomain.mutation',
        retryLabelKey: 'agent.operations.resync',
        retry: () => void refreshDetailSubagents(delegation.runId),
      });
      if (decision.refreshAuthoritativeState) {
        try {
          await refreshDetailSubagents(delegation.runId);
          if (decision.phase === 'conflict') runtimeOperation.succeed();
        } catch {
          // Keep conflict/reconciliation state locked until an authoritative refresh succeeds.
        }
      }
    } finally {
      finishRuntimeMutation();
    }
  };

  const openRunDetail = async (candidate: AgentRunViewDto): Promise<void> => {
    const requestGeneration = ++detailOpenGeneration;
    const approvalGeneration = ++detailApprovalGeneration;
    detailSubagentsGeneration += 1;
    subagentMessagesGeneration += 1;
    const auxiliary = Promise.allSettled([
      facade.listCheckpoints(candidate.id),
      facade.listApprovals(candidate.id),
      facade.listSubagents(candidate.id),
    ]);
    try {
      const snapshot = await facade.getRun(candidate.id);
      if (requestGeneration !== detailOpenGeneration) return;
      detailSnapshot.value = snapshot;
      clearError(DETAIL_FAILURE_DOMAIN);
      detailCheckpoints.value = [];
      detailApprovalBatch.value = null;
      detailSubagents.value = [];
      selectedSubagentId.value = null;
      detailSubagentMessages.value = [];
      detailVisible.value = true;

      const [checkpoints, detailApprovals, subagents] = await auxiliary;
      if (requestGeneration !== detailOpenGeneration || detailSnapshot.value?.id !== candidate.id) return;
      if (checkpoints.status === 'fulfilled') {
        detailCheckpoints.value = checkpoints.value;
        clearError('agent.operations.failureDomain.checkpoints');
      }
      if (detailApprovals.status === 'fulfilled' && approvalGeneration === detailApprovalGeneration) {
        detailApprovalBatch.value = detailApprovals.value;
        clearError('agent.operations.failureDomain.approvals');
      }
      if (subagents.status === 'fulfilled') {
        detailSubagents.value = subagents.value.items;
        clearError(DETAIL_FAILURE_DOMAIN);
      }
      const auxiliaryResults = [
        checkpoints,
        approvalGeneration === detailApprovalGeneration ? detailApprovals : null,
        subagents,
      ];
      const failureIndex = auxiliaryResults.findIndex((result) => result?.status === 'rejected');
      const failure = failureIndex < 0 ? null : (auxiliaryResults[failureIndex] as PromiseRejectedResult | null);
      if (failure) {
        fail(failure.reason, {
          domainKey: DETAIL_AUXILIARY_FAILURE_DOMAINS[failureIndex] ?? DETAIL_FAILURE_DOMAIN,
          retry: () => void openRunDetail(candidate),
        });
      }
    } catch (cause) {
      if (requestGeneration !== detailOpenGeneration) return;
      fail(cause, {
        domainKey: DETAIL_FAILURE_DOMAIN,
        retry: () => void openRunDetail(candidate),
      });
    }
  };

  const closeRunDetail = (): void => {
    detailOpenGeneration += 1;
    detailApprovalGeneration += 1;
    detailSubagentsGeneration += 1;
    subagentMessagesGeneration += 1;
    detailVisible.value = false;
    detailApprovalBatch.value = null;
  };

  const saveCheckpoint = async (snapshot: AgentRunSnapshotDto | AgentRunViewDto): Promise<void> => {
    if (!beginRuntimeMutation()) return;
    try {
      const created = await facade.saveCheckpoint(snapshot as AgentRunSnapshotDto);
      detailCheckpoints.value = [
        created,
        ...detailCheckpoints.value.filter((checkpoint) => checkpoint.id !== created.id),
      ];
      if (run.value?.id === snapshot.id) {
        currentRunCheckpoints.value = [
          created,
          ...currentRunCheckpoints.value.filter((checkpoint) => checkpoint.id !== created.id),
        ];
      }
      runtimeOperation.succeed();
      const refreshCheckpoints = async (): Promise<void> => {
        const cps = await facade.listCheckpoints(snapshot.id);
        detailCheckpoints.value = cps;
        if (run.value?.id === snapshot.id) currentRunCheckpoints.value = cps;
      };
      await postCommitSync(refreshCheckpoints, {
        domainKey: 'agent.operations.failureDomain.checkpoints',
        retry: () => void refreshCheckpoints(),
      });
    } catch (cause) {
      await recoverRuntimeFailure(cause, snapshot.id);
    } finally {
      finishRuntimeMutation();
    }
  };

  let pendingCheckpointResumeIdentity: { fingerprint: string; idempotencyKey: string } | null = null;

  const checkpointResumeIdempotencyKey = (
    snapshot: AgentRunSnapshotDto | AgentRunViewDto,
    checkpoint: AgentCheckpointViewDto,
  ): string => {
    const fingerprint = JSON.stringify([snapshot.id, checkpoint.id, snapshot.version]);
    if (!pendingCheckpointResumeIdentity || pendingCheckpointResumeIdentity.fingerprint !== fingerprint) {
      pendingCheckpointResumeIdentity = { fingerprint, idempotencyKey: crypto.randomUUID() };
    }
    return pendingCheckpointResumeIdentity.idempotencyKey;
  };

  const resumeCheckpoint = async (
    snapshot: AgentRunSnapshotDto | AgentRunViewDto,
    checkpoint: AgentCheckpointViewDto,
  ): Promise<void> => {
    if (!beginRuntimeMutation()) return;
    const idempotencyKey = checkpointResumeIdempotencyKey(snapshot, checkpoint);
    try {
      const resumed = await facade.resumeRun(snapshot, checkpoint.id, idempotencyKey);
      if (pendingCheckpointResumeIdentity?.idempotencyKey === idempotencyKey) {
        pendingCheckpointResumeIdentity = null;
      }
      run.value = resumed;
      rememberThreadRun(resumed);
      detailSnapshot.value = null;
      detailCheckpoints.value = [];
      detailVisible.value = false;
      startRunStream(resumed);
      runtimeOperation.succeed();
      await postCommitSync(
        () =>
          Promise.all([refreshLedger(), refreshApprovals(resumed.id), refreshBackgroundRuns()]).then(() => undefined),
        {
          domainKey: 'agent.operations.failureDomain.run',
          retry: () => void refreshRun(resumed.id),
        },
      );
    } catch (cause) {
      await recoverRuntimeFailure(cause, snapshot.id);
    } finally {
      finishRuntimeMutation();
    }
  };

  const deleteRun = async (snapshot: AgentRunSnapshotDto): Promise<void> => {
    if (!beginRuntimeMutation()) return;
    try {
      await facade.deleteRun(snapshot);
      if (detailSnapshot.value?.id === snapshot.id) closeRunDetail();
      if (currentThread.value?.id === snapshot.threadId) {
        threadRuns.value = threadRuns.value.filter((candidate) => candidate.id !== snapshot.id);
        if (run.value?.id === snapshot.id) {
          stopRunStream();
          run.value =
            threadRuns.value.find((candidate) => isAgentRunNonTerminal(candidate.status)) ??
            threadRuns.value[0] ??
            null;
          approvalBatch.value = null;
          if (run.value && isAgentRunNonTerminal(run.value.status)) startRunStream(run.value);
        }
      }
      runtimeOperation.succeed();
      const resyncDeletedRun = async (): Promise<void> => {
        const refreshes: Promise<void>[] = [];
        if (currentThread.value?.id === snapshot.threadId) {
          const page = await facade.listRuns(snapshot.threadId);
          threadRuns.value = page.items;
          refreshes.push(refreshApprovals(run.value?.id), refreshLedger());
        }
        refreshes.push(refreshBackgroundRuns());
        const results = await Promise.allSettled(refreshes);
        const failed = results.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      };
      await postCommitSync(resyncDeletedRun, {
        domainKey: 'agent.operations.failureDomain.run',
        retry: () => void resyncDeletedRun(),
      });
    } catch (cause) {
      await recoverRuntimeFailure(cause, snapshot.id);
    } finally {
      finishRuntimeMutation();
    }
  };

  const clearThreadDeleteArm = (): void => {
    threadDeleteArmedId.value = null;
    if (threadDeleteArmTimer !== null) window.clearTimeout(threadDeleteArmTimer);
    threadDeleteArmTimer = null;
  };

  const clearDeleteAllThreadsArm = (): void => {
    deleteAllThreadsArmed.value = false;
    if (deleteAllThreadsArmTimer !== null) window.clearTimeout(deleteAllThreadsArmTimer);
    deleteAllThreadsArmTimer = null;
  };

  const resetDeletedThreadSelection = (): void => {
    threadSelectionGeneration += 1;
    stopRunStream();
    threadContentReady.value = false;
    currentThread.value = null;
    entries.value = [];
    run.value = null;
    threadRuns.value = [];
    approvalBatch.value = null;
    nextCursor.value = null;
    currentRunCheckpoints.value = [];
    agentSurfaceSession.setThread(props.appId);
  };

  const selectFirstOrCreateThread = async (): Promise<void> => {
    invalidateThreadPagination();
    const page = await facade.listThreads(undefined, threadPageSize.value);
    threads.value = page.items;
    threadNextCursor.value = page.nextCursor;
    const next = page.items[0];
    if (next) {
      await selectThread(next);
      return;
    }
    const created = await facade.createThread();
    threads.value = [created];
    threadNextCursor.value = null;
    await selectThread(created);
  };

  const deleteThreadConversation = async (thread: AgentThreadViewDto): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    clearError('agent.operations.failureDomain.threads');
    clearThreadDeleteArm();
    try {
      const deletingCurrent = currentThread.value?.id === thread.id;
      await facade.deleteThread(thread);
      threadContextCache.delete(thread.id);
      invalidateThreadPagination();
      threads.value = threads.value.filter((candidate) => candidate.id !== thread.id);
      if (detailSnapshot.value?.threadId === thread.id) closeRunDetail();
      if (deletingCurrent) {
        resetDeletedThreadSelection();
        clearComposer(true);
      }
      runtimeOperation.succeed();
      await postCommitSync(
        async () => {
          if (deletingCurrent) await selectFirstOrCreateThread();
          await refreshBackgroundRuns();
        },
        { domainKey: 'agent.operations.failureDomain.threads', retry: () => void load() },
      );
    } catch (cause) {
      fail(cause, {
        domainKey: 'agent.operations.failureDomain.threads',
        retryLabelKey: 'agent.operations.resync',
        retry: () => void load(),
      });
      runtimeOperation.fail(cause);
    } finally {
      busy.value = false;
    }
  };

  const requestDeleteThread = (thread: AgentThreadViewDto): void => {
    const status = threadStatus(thread.id);
    if (status && isAgentRunNonTerminal(status)) return;
    if (threadDeleteArmedId.value === thread.id) {
      void deleteThreadConversation(thread);
      return;
    }
    clearThreadDeleteArm();
    threadDeleteArmedId.value = thread.id;
    threadDeleteArmTimer = window.setTimeout(clearThreadDeleteArm, 5000);
  };

  const deleteAllConversations = async (): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    clearError('agent.operations.failureDomain.threads');
    clearDeleteAllThreadsArm();
    clearThreadDeleteArm();
    try {
      await facade.deleteAllThreads();
      threadContextCache.clear();
      invalidateThreadPagination();
      closeRunDetail();
      resetDeletedThreadSelection();
      backgroundRuns.value = [];
      threadSidebar.value?.resetScroll();
      clearComposer(true);
      runtimeOperation.succeed();
      await postCommitSync(() => selectFirstOrCreateThread(), {
        domainKey: 'agent.operations.failureDomain.threads',
        retry: () => void load(),
      });
    } catch (cause) {
      fail(cause, {
        domainKey: 'agent.operations.failureDomain.threads',
        retryLabelKey: 'agent.operations.resync',
        retry: () => void load(),
      });
      runtimeOperation.fail(cause);
    } finally {
      busy.value = false;
    }
  };

  const requestDeleteAllConversations = (): void => {
    if (activeThreadCount.value > 0) return;
    if (deleteAllThreadsArmed.value) {
      void deleteAllConversations();
      return;
    }
    clearDeleteAllThreadsArm();
    deleteAllThreadsArmed.value = true;
    deleteAllThreadsArmTimer = window.setTimeout(clearDeleteAllThreadsArm, 5000);
  };

  const loadOlder = async (): Promise<void> => {
    const thread = currentThread.value;
    const cursor = nextCursor.value;
    if (!thread || !cursor || busy.value) return;
    const requestGeneration = ++ledgerGeneration;
    busy.value = true;
    try {
      const page = await facade.readLedger(thread.id, cursor);
      if (requestGeneration !== ledgerGeneration || currentThread.value?.id !== thread.id) return;
      const known = new Set(entries.value.map((entry) => entry.id));
      entries.value = [...page.items.filter((entry) => !known.has(entry.id)), ...entries.value];
      nextCursor.value = page.nextCursor;
    } finally {
      busy.value = false;
    }
  };

  const updateDraft = (value: string): void => {
    draft.value = value;
    agentSurfaceSession.setDraft(props.appId, value);
  };

  const refreshConnectionsAndAuthorization = async (): Promise<void> => {
    const requestGeneration = ++authorizationGeneration;
    try {
      const [nextDenylist] = await Promise.all([agentApi.targetDenylist(), connectionsStore.revalidate(0)]);
      if (surfaceDisposed || requestGeneration !== authorizationGeneration) return;
      targetDenylist.value = nextDenylist;
    } catch (cause) {
      if (surfaceDisposed || requestGeneration !== authorizationGeneration) return;
      throw cause;
    }
  };

  const refreshConnectionsOnFocus = (): void => {
    void refreshConnectionsAndAuthorization().catch(() => undefined);
  };

  const onAuthorizationChanged = (): void => {
    void refreshConnectionsAndAuthorization().catch(() => undefined);
  };

  const onConfigurationChanged = (): void => {
    void loadRunConfiguration().catch((cause) => {
      fail(cause, {
        domainKey: 'agent.operations.failureDomain.configuration',
        retry: () => void loadRunConfiguration(),
      });
    });
  };

  let stopThreadChanged = (): void => {};

  let stopAuthorizationChanged = (): void => {};

  let stopConfigurationChanged = (): void => {};

  onMounted(() => {
    window.addEventListener('focus', refreshConnectionsOnFocus);
    stopThreadChanged = agentHostEvents.on('thread-changed', onThreadChanged);
    stopAuthorizationChanged = agentHostEvents.on('authorization-changed', onAuthorizationChanged);
    stopConfigurationChanged = agentHostEvents.on('configuration-changed', onConfigurationChanged);
    void nextTick(() => {
      void load();
    });
  });

  onBeforeUnmount(() => {
    clearThreadDeleteArm();
    clearDeleteAllThreadsArm();
    window.removeEventListener('focus', refreshConnectionsOnFocus);
    stopThreadChanged();
    stopAuthorizationChanged();
    stopConfigurationChanged();
    surfaceDisposed = true;
    configurationGeneration += 1;
    authorizationGeneration += 1;
    facade.dispose();
    resetStreamingPresentation();
  });
  return {
    runtimeOperation,
    appExecutable,
    threads,
    threadNextCursor,
    threadListLoadingMore,
    currentThread,
    entries,
    nextCursor,
    run,
    pendingInputRequest,
    reconciliationDetails,
    reconciliationBusy,
    threadRuns,
    connections,
    attachments,
    approvalBatch,
    approvals,
    pendingApprovals,
    hardLimits,
    backgroundRuns,
    detailSnapshot,
    detailCheckpoints,
    currentRunCheckpoints,
    detailApprovalBatch,
    error,
    errorCode,
    errorRetry,
    detailSubagents,
    selectedSubagentId,
    detailSubagentMessages,
    detailVisible,
    selectedModelKey,
    taskRailVisible,
    threadDeleteArmedId,
    deleteAllThreadsArmed,
    threadSidebarVisible,
    threadsOverlay,
    threadDrawerOpen,
    threadSidebar,
    threadPageSize,
    streamingText,
    busy,
    loading,
    selectingThread,
    threadContentReady,
    draft,
    commandResult,
    activeThreadCount,
    threadStatuses,
    threadTitles,
    modelOptions,
    providerSelection,
    modelOptionHint,
    modelSelectionLocked,
    executionModeValue,
    setExecutionMode,
    approvalModeValue,
    setApprovalMode,
    reasoningLevels,
    reasoningCapabilityAvailable,
    reasoningValue,
    activeReasoningIndex,
    isDraggingReasoning,
    thumbLeftPercent,
    trackFillPercent,
    isUltraOrMax,
    currentReasoningDescription,
    reasoningTrackRef,
    reasoningDisplayLabel,
    onTrackPointerDown,
    onTrackPointerMove,
    onTrackPointerUp,
    onTrackPointerCancel,
    displayedConnectionIds,
    mutationLocked,
    canSend,
    clearCurrentError,
    errorDomainLabel,
    errorRetryLabel,
    retryFailedOperation,
    setModelSelection,
    toggleConnectionSelection,
    connectionSelectionState,
    toggleAllConnectionSelections,
    resolveReconciliation,
    selectThread,
    beginThreadCreation,
    loadMoreThreads,
    send,
    cancel,
    increaseBudget,
    resolveApproval,
    selectSubagent,
    cancelSubagent,
    openRunDetail,
    closeRunDetail,
    saveCheckpoint,
    resumeCheckpoint,
    deleteRun,
    requestDeleteThread,
    requestDeleteAllConversations,
    loadOlder,
    updateDraft,
    THREADS_OVERLAY_BREAKPOINT,
  };
}
