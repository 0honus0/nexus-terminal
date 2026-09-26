<script setup lang="ts">
  import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, nextTick, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { logger } from '@/client/logging/logger';
  import { useConnections } from '@/features/connections/public';
  import { UiButton, UiInfoHint } from '@/foundation/ui';
  import AgentConversation from '../ai/AgentConversation.vue';
  import {
    createConversationCommandExecutor,
    type ConversationCommandResult,
  } from '../ai/conversation-command-executor';
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
    AgentWorkspaceRuntimeAvailabilityDto,
    AgentWorkspaceRuntimeCatalogDto,
  } from '../api/agent-api';
  import { agentRunAcceptsInput, isAgentRunNonTerminal } from '../api/agent-api';
  import { agentHostEvents } from './agent-host-events';
  import { agentWindowManager } from './window-manager';
  import { agentSurfaceSession } from './surface-session';
  import {
    clearAgentSurfaceFailure,
    clearAgentSurfaceFailures,
    latestAgentSurfaceFailure,
    upsertAgentSurfaceFailure,
    type AgentSurfaceFailure,
  } from './agent-surface-failures';
  import AgentThreadSidebar from './AgentThreadSidebar.vue';
  import AgentConfigPopover from '../files/AgentConfigPopover.vue';
  import ApprovalCard from '../runtime/ApprovalCard.vue';
  import { createAgentRunFacade } from '../runtime/run-facade';
  import { createRuntimeOperationState } from '../runtime/runtime-operation-state';

  const TaskRail = defineAsyncComponent(() => import('../runtime/TaskRail.vue'));

  const props = defineProps<{
    appId: string;
    defaultApprovalMode: AgentApprovalModeDto;
    appHealth: AgentAppHealth;
    appHealthReason: string | null;
  }>();
  const { t } = useI18n();
  const facade = createAgentRunFacade(props.appId);
  const connectionsStore = useConnections();
  facade.start();
  const runtimeOperation = createRuntimeOperationState();
  const appExecutable = computed(() => isAgentAppExecutableHealth(props.appHealth));
  const threads = ref<AgentThreadViewDto[]>([]);
  const threadNextCursor = ref<string | null>(null);
  const threadListLoadingMore = ref(false);
  const THREAD_PAGE_MAX = 100;
  const currentThread = ref<AgentThreadViewDto | null>(null);
  const entries = ref<AgentLedgerEntryDto[]>([]);
  const nextCursor = ref<string | null>(null);
  const run = ref<AgentRunViewDto | null>(null);
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
    return connectionsStore.connections.value.filter(
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
  const workspaceRuntimeAvailability = ref<AgentWorkspaceRuntimeAvailabilityDto | null>(null);
  const workspaceRuntimeCatalog = ref<AgentWorkspaceRuntimeCatalogDto | null>(null);
  const backgroundRuns = ref<AgentRunViewDto[]>([]);
  const detailSnapshot = ref<AgentRunSnapshotDto | null>(null);
  const detailCheckpoints = ref<AgentCheckpointViewDto[]>([]);
  const currentRunCheckpoints = ref<AgentCheckpointViewDto[]>([]);
  const detailApprovalBatch = shallowRef<AgentApprovalBatchViewModel | null>(null);
  interface AgentSurfaceRetry {
    labelKey: string;
    run: () => void;
  }

  const DETAIL_FAILURE_DOMAIN = 'agent.operations.failureDomain.detail';
  // Human-facing label for each auxiliary Run-detail request (checkpoints / approvals / subagents).
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
  const detailSubagents = ref<AgentSubagentViewDto[]>([]);
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
  const selectedEnvironmentRecipeId = ref(agentSurfaceSession.restoreEnvironmentRecipeId(props.appId) ?? '');
  /*
   * §7.2-c/-e: both panels used to start closed on every session and the sidebar
   * could not be collapsed at all on wide windows. They now read their initial
   * value from the persisted window layout and write every toggle back to it.
   */
  const taskRailVisible = ref(agentWindowManager.state.taskRailVisible);
  const threadDeleteArmedId = ref<string | null>(null);
  const deleteAllThreadsArmed = ref(false);
  const threadSidebarVisible = ref(agentWindowManager.state.threadSidebarVisible);
  /*
   * The sidebar is a docked column on wide containers and an overlay drawer below the
   * 760px container query. Only the dock intent is worth persisting; the drawer is
   * transient and closes as soon as a thread is picked, so it stays local.
   */
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
  const enabledEnvironmentRecipes = computed(() => {
    const catalog = workspaceRuntimeCatalog.value;
    const settings = settingsView.value;
    if (!catalog || !settings) return [];
    const enabled = new Set(settings.effectiveSettings.workspaceRuntime.enabledRecipeIds);
    return catalog.recipes.filter((recipe) => enabled.has(recipe.id));
  });
  const selectedEnvironmentRecipe = computed(
    () => enabledEnvironmentRecipes.value.find((recipe) => recipe.id === selectedEnvironmentRecipeId.value) ?? null,
  );
  const activeEnvironment = computed(() =>
    modelSelectionLocked.value ? (run.value?.definition.environment ?? null) : null,
  );
  const environmentLabel = computed(() => {
    if (modelSelectionLocked.value) {
      const frozen = activeEnvironment.value;
      if (!frozen) return t('agent.operations.environmentNone');
      return (
        workspaceRuntimeCatalog.value?.recipes.find((recipe) => recipe.id === frozen.recipeId)?.displayName ??
        frozen.recipeId
      );
    }
    if (selectedEnvironmentRecipe.value) return selectedEnvironmentRecipe.value.displayName;
    const availability = workspaceRuntimeAvailability.value;
    if (!availability?.available) return t('agent.operations.environmentNone');
    return t('agent.operations.environmentNone');
  });
  const environmentStatusClass = computed(() => {
    if (modelSelectionLocked.value) return activeEnvironment.value ? 'bg-success' : 'bg-text-secondary/50';
    if (!selectedEnvironmentRecipe.value) return 'bg-text-secondary/50';
    const availability = workspaceRuntimeAvailability.value;
    if (!availability) return 'bg-text-secondary/40';
    if (!availability.available) return 'bg-text-secondary/50';
    return 'bg-success';
  });
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

  const setEnvironmentSelection = (recipeId: string): void => {
    if (modelSelectionLocked.value) return;
    if (recipeId && !enabledEnvironmentRecipes.value.some((recipe) => recipe.id === recipeId)) return;
    selectedEnvironmentRecipeId.value = recipeId;
    agentSurfaceSession.setEnvironmentRecipeId(props.appId, recipeId || undefined);
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
        const recoveryEvent =
          event.type === 'run.recovery_continued' ||
          event.type === 'run.recovery_deferred' ||
          event.type === 'run.recovery_failed';
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
      const active =
        selectedRun && !isAgentRunNonTerminal(selectedRun.status) ? await facade.getRun(selectedRun.id) : selectedRun;
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
      const [nextDefinitions, nextProviders, settings, , runtimeAvailability, nextDenylist] = await Promise.all([
        facade.definitions(),
        facade.providers(),
        facade.settings(),
        connectionsStore.revalidate(0),
        agentApi.workspaceRuntimeAvailability().catch(() => null),
        agentApi.targetDenylist(),
      ]);
      const runtimeCatalog = runtimeAvailability?.available
        ? await agentApi.workspaceRuntimeCatalog().catch(() => null)
        : null;
      if (surfaceDisposed || requestGeneration !== configurationGeneration) return;

      definitions.value = nextDefinitions;
      providers.value = nextProviders;
      settingsView.value = settings;
      workspaceRuntimeAvailability.value = runtimeAvailability;
      workspaceRuntimeCatalog.value = runtimeCatalog;
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
      const restoredEnvironmentId = agentSurfaceSession.restoreEnvironmentRecipeId(props.appId);
      const selectedEnvironment =
        enabledEnvironmentRecipes.value.find((recipe) => recipe.id === restoredEnvironmentId) ??
        enabledEnvironmentRecipes.value[0] ??
        null;
      selectedEnvironmentRecipeId.value = selectedEnvironment?.id ?? '';
      agentSurfaceSession.setEnvironmentRecipeId(props.appId, selectedEnvironment?.id);
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
        environmentRecipeId: selectedEnvironmentRecipe.value?.id ?? null,
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
      environment: selectedEnvironmentRecipe.value
        ? {
            recipeId: selectedEnvironmentRecipe.value.id,
            ...(workspaceRuntimeCatalog.value ? { catalogRevision: workspaceRuntimeCatalog.value.revision } : {}),
          }
        : null,
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
        if (currentThread.value?.id === snapshot.threadId) {
          const page = await facade.listRuns(snapshot.threadId);
          threadRuns.value = page.items;
          await refreshApprovals(run.value?.id);
          await refreshLedger();
        }
        await refreshBackgroundRuns();
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

  // Settings writes / provider edits (model added, provider toggled) must reach the open
  // surface without a page reload, otherwise the model list keeps showing the stale set.
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
  /*
   * §7.2-c: measures this surface (never the viewport, per FRONTEND.md:519) so the
   * toggle knows whether it is moving the docked column or the overlay drawer. The
   * breakpoint mirrors the `agent-hub-window` container query below.
   */
  const layoutRoot = ref<HTMLElement | null>(null);
  let layoutObserver: ResizeObserver | null = null;
  onMounted(() => {
    if (!layoutRoot.value || typeof ResizeObserver === 'undefined') return;
    layoutObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      threadsOverlay.value = width <= THREADS_OVERLAY_BREAKPOINT;
    });
    layoutObserver.observe(layoutRoot.value);
  });
  onBeforeUnmount(() => {
    layoutObserver?.disconnect();
    layoutObserver = null;
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
</script>

<template>
  <div
    ref="layoutRoot"
    class="agent-surface-layout relative grid h-full min-h-0"
    :class="{ 'has-task-rail': taskRailVisible, 'is-threads-hidden': !threadSidebarVisible }"
  >
    <AgentThreadSidebar
      ref="threadSidebar"
      :open="threadDrawerOpen"
      :threads="threads"
      :next-cursor="threadNextCursor"
      :loading-more="threadListLoadingMore"
      :active-thread-count="activeThreadCount"
      :busy="busy"
      :current-thread-id="currentThread?.id ?? null"
      :thread-statuses="threadStatuses"
      :thread-delete-armed-id="threadDeleteArmedId"
      :delete-all-threads-armed="deleteAllThreadsArmed"
      @close="threadDrawerOpen = false"
      @new-thread="beginThreadCreation"
      @select="selectThread"
      @delete-thread="requestDeleteThread"
      @delete-all="requestDeleteAllConversations"
      @load-more="loadMoreThreads"
      @page-size="threadPageSize = $event"
    />

    <main class="agent-conversation-pane flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <header class="shrink-0 border-b border-border/50 bg-header/40 backdrop-blur-xs">
        <div class="flex h-9 items-center justify-between gap-3 px-3.5">
          <div class="flex min-w-0 items-center gap-2">
            <button
              type="button"
              class="agent-thread-toggle flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg border transition-colors"
              :class="
                (threadsOverlay ? threadDrawerOpen : threadSidebarVisible)
                  ? 'border-border bg-card text-foreground shadow-xs ring-1 ring-border/20'
                  : 'border-border/70 bg-card/60 text-text-secondary hover:border-border hover:bg-header hover:text-foreground'
              "
              :aria-expanded="threadsOverlay ? threadDrawerOpen : threadSidebarVisible"
              aria-controls="agent-thread-sidebar"
              :aria-label="$t('agent.operations.openThreads')"
              :title="$t('agent.operations.openThreads')"
              @click="
                threadsOverlay ? (threadDrawerOpen = !threadDrawerOpen) : (threadSidebarVisible = !threadSidebarVisible)
              "
            >
              <i class="fa-regular fa-comments text-xs" aria-hidden="true"></i>
            </button>
            <div class="min-w-0 flex items-center gap-2">
              <i class="fa-regular fa-message text-[11px] text-text-secondary/60 shrink-0" aria-hidden="true"></i>
              <span class="truncate text-xs font-semibold text-foreground tracking-tight">{{
                currentThread?.title || $t('agent.operations.untitledThread')
              }}</span>
              <span
                v-if="run"
                class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none"
                :class="
                  run.status === 'running'
                    ? 'bg-success/10 text-success'
                    : run.status === 'awaiting_approval' || run.status === 'awaiting_budget'
                      ? 'bg-warning/10 text-warning'
                      : run.status === 'failed'
                        ? 'bg-error/10 text-error'
                        : 'bg-header text-text-secondary'
                "
              >
                {{ $t(`agent.tasks.runStatus.${run.status}`) }}
              </span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              v-if="currentThread"
              type="button"
              class="agent-header-thread-delete hidden h-7.5 w-7.5 items-center justify-center rounded-lg border transition-all disabled:cursor-not-allowed disabled:opacity-50"
              :class="
                threadDeleteArmedId === currentThread.id
                  ? 'border-error/30 bg-error/10 text-error'
                  : 'border-border/70 bg-card/60 text-text-secondary hover:border-error/30 hover:bg-error/10 hover:text-error'
              "
              :aria-label="
                threadDeleteArmedId === currentThread.id
                  ? $t('agent.operations.confirmDeleteThread')
                  : $t('agent.operations.deleteThread')
              "
              :title="
                run && isAgentRunNonTerminal(run.status)
                  ? $t('agent.operations.deleteThreadActiveHint')
                  : threadDeleteArmedId === currentThread.id
                    ? $t('agent.operations.confirmDeleteThread')
                    : $t('agent.operations.deleteThread')
              "
              :disabled="busy || Boolean(run && isAgentRunNonTerminal(run.status))"
              @click="requestDeleteThread(currentThread)"
            >
              <i class="fa-solid fa-trash-can text-[10px]" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="relative flex h-7.5 w-7.5 items-center justify-center rounded-lg border transition-all"
              :class="
                taskRailVisible
                  ? 'border-border bg-card text-foreground shadow-xs ring-1 ring-border/20'
                  : 'border-border/70 bg-card/60 text-text-secondary hover:border-border hover:bg-header hover:text-foreground'
              "
              :aria-expanded="taskRailVisible"
              aria-controls="agent-task-rail"
              :aria-label="$t('agent.ui.toggleTasks')"
              :title="$t('agent.ui.toggleTasks')"
              @click="taskRailVisible = !taskRailVisible"
            >
              <i class="fa-solid fa-table-columns text-xs" aria-hidden="true"></i>
              <span
                v-if="pendingApprovals.length || backgroundRuns.length"
                class="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none text-white shadow-xs"
                :class="pendingApprovals.length ? 'bg-warning' : 'bg-primary'"
              >
                {{ pendingApprovals.length || backgroundRuns.length }}
              </span>
            </button>
          </div>
        </div>
      </header>

      <div class="relative min-h-0 flex-1">
        <div
          v-if="loading || (selectingThread && !threadContentReady)"
          data-testid="agent-thread-loading"
          class="flex h-full items-center justify-center"
        >
          <div class="flex flex-col items-center gap-3 text-text-secondary">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-card text-foreground"
            >
              <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
            </div>
            <span class="text-xs">{{ $t('agent.operations.loading') }}</span>
          </div>
        </div>
        <div v-else-if="error && entries.length === 0" class="flex h-full items-center justify-center p-6 text-sm">
          <div class="max-w-sm rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-error" role="alert">
            <div class="flex items-start gap-2">
              <i class="fa-solid fa-circle-exclamation mt-1" aria-hidden="true"></i>
              <div class="min-w-0 flex-1 break-words text-left" :title="errorCode">
                <div v-if="errorDomainLabel" class="text-[11px] font-semibold text-error/80">
                  {{ errorDomainLabel }}
                </div>
                <div>{{ error }}</div>
              </div>
            </div>
            <div v-if="errorRetry" class="mt-2 flex justify-end">
              <UiButton
                appearance="soft"
                tone="neutral"
                density="compact"
                :title="$t('agent.operations.retryHint')"
                @click="retryFailedOperation"
              >
                {{ errorRetryLabel }}
              </UiButton>
            </div>
          </div>
        </div>
        <div v-else class="relative h-full min-h-0">
          <div
            v-if="!appExecutable"
            class="pointer-events-none absolute left-1/2 top-3 z-20 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning shadow-sm backdrop-blur-sm"
            role="status"
          >
            <div class="font-medium">{{ $t('agent.operations.appUnavailable') }}</div>
            <div v-if="appHealthReason" class="mt-0.5 break-words text-[11px] text-warning/80">
              {{ $t('agent.operations.appUnavailableReason', { reason: appHealthReason }) }}
            </div>
          </div>
          <AgentConversation
            :app-id="appId"
            :error="error"
            :error-domain="errorDomainLabel"
            :error-code="errorCode"
            :can-retry="errorRetry !== null"
            :retry-label="errorRetryLabel"
            :reconciliation="run?.needsReconciliation === true || runtimeOperation.phase.value === 'reconciling'"
            :reconciliation-details="reconciliationDetails"
            :reconciliation-busy="reconciliationBusy"
            @dismiss-error="clearCurrentError"
            @retry-error="retryFailedOperation"
            :entries="entries"
            :next-cursor="nextCursor"
            :run="run"
            :input-request="pendingInputRequest"
            :streaming-text="streamingText"
            :draft="draft"
            :busy="mutationLocked"
            :can-send="canSend"
            :attachments="attachments"
            :command-result="commandResult"
            @load-older="loadOlder"
            @send="send"
            @cancel="cancel"
            @update-draft="updateDraft"
            @update-attachments="attachments = $event"
            @dismiss-command-result="commandResult = null"
            @resolve-reconciliation="resolveReconciliation"
          >
            <template #approvals>
              <div
                v-if="approvalBatch?.clock && pendingApprovals.length"
                class="mx-auto mb-5 w-full max-w-3xl rounded-2xl border border-warning/25 bg-warning/[0.035] p-2.5 shadow-sm"
              >
                <div class="mb-2 flex items-center gap-2 px-1 text-[11px] text-text-secondary">
                  <span class="flex h-6 w-6 items-center justify-center rounded-lg bg-warning/12 text-warning">
                    <i class="fa-solid fa-shield-halved text-[9px]" aria-hidden="true"></i>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="font-semibold text-foreground">{{ $t('agent.conversation.approvalRequestTitle') }}</div>
                    <div class="mt-0.5 text-[11px] leading-4 text-text-secondary/75">
                      {{ $t('agent.conversation.approvalRequestHint') }}
                    </div>
                  </div>
                </div>
                <div class="space-y-2">
                  <ApprovalCard
                    v-for="approval in pendingApprovals"
                    :key="approval.id"
                    :approval="approval"
                    :clock="approvalBatch.clock"
                    :busy="mutationLocked"
                    @resolve="resolveApproval"
                  />
                </div>
              </div>
            </template>
            <template #configuration>
              <div class="agent-run-config flex min-h-7 items-center gap-1">
                <div
                  v-if="modelSelectionLocked && run"
                  class="agent-config-summary flex h-[26px] items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2 text-[11px] font-medium text-text-secondary transition-colors duration-150 select-none hover:border-border/50 hover:bg-header/70 hover:text-foreground"
                  :title="`${$t('agent.operations.runModelLocked')}: ${run.definition.model.modelId}`"
                >
                  <i class="fa-solid fa-microchip shrink-0 text-[9px] text-text-secondary" aria-hidden="true"></i>
                  <span class="agent-config-verbose max-w-28 truncate whitespace-nowrap text-foreground text-left">
                    {{ run.definition.model.modelId }}
                  </span>
                  <i class="fa-solid fa-lock shrink-0 text-[7px] text-text-secondary" aria-hidden="true"></i>
                </div>
                <AgentConfigPopover
                  v-else-if="modelOptions.length"
                  :ariaLabel="$t('agent.operations.runModel')"
                  :title="`${$t('agent.operations.runModelHint')}: ${providerSelection?.model.id ?? ''}`"
                  panel-class="w-72"
                >
                  <template #trigger>
                    <i class="fa-solid fa-microchip text-[9px] text-text-secondary" aria-hidden="true"></i>
                    <span class="agent-config-verbose max-w-28 truncate whitespace-nowrap text-left">{{
                      providerSelection?.model.id
                    }}</span>
                    <i
                      class="agent-config-affordance fa-solid fa-chevron-down text-[7px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel="{ close }">
                    <div class="mb-2 flex items-center justify-between gap-2 px-1">
                      <span class="text-xs font-semibold">{{ $t('agent.operations.runModel') }}</span>
                    </div>
                    <div class="max-h-72 space-y-1 overflow-y-auto">
                      <button
                        v-for="option in modelOptions"
                        :key="option.key"
                        type="button"
                        class="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors"
                        :class="[
                          option.key === selectedModelKey
                            ? 'bg-primary/8 font-medium text-foreground'
                            : 'text-text-secondary hover:bg-card/70',
                          option.compatible ? '' : 'cursor-not-allowed opacity-55',
                        ]"
                        :disabled="busy || !option.compatible"
                        @click="
                          setModelSelection(option.key);
                          close(true);
                        "
                      >
                        <span
                          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                          :class="
                            option.key === selectedModelKey
                              ? 'bg-primary/10 text-primary'
                              : 'bg-header text-text-secondary'
                          "
                        >
                          <i class="fa-solid fa-microchip text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-xs font-medium text-foreground">{{ option.model.id }}</span>
                          <span class="mt-0.5 block truncate text-[11px] text-text-secondary">
                            {{ modelOptionHint(option) }}
                          </span>
                        </span>
                        <i
                          v-if="option.key === selectedModelKey"
                          class="fa-solid fa-check text-[10px] text-primary"
                          aria-hidden="true"
                        ></i>
                      </button>
                    </div>
                  </template>
                </AgentConfigPopover>
                <div
                  v-else
                  class="agent-config-summary flex h-[26px] shrink-0 items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2 text-[11px] font-medium text-text-secondary select-none"
                  :title="$t('agent.operations.providerMissing')"
                >
                  <i class="fa-solid fa-microchip shrink-0 text-[9px] text-text-secondary" aria-hidden="true"></i>
                  <span class="agent-config-verbose max-w-28 truncate whitespace-nowrap text-left">{{
                    $t('agent.operations.providerMissing')
                  }}</span>
                </div>
                <!-- 思考强度：GPT 官方饱满胶囊滑块卡片 -->
                <AgentConfigPopover
                  v-if="reasoningCapabilityAvailable || (modelSelectionLocked && reasoningValue)"
                  :ariaLabel="$t('agent.ui.reasoning')"
                  :title="`${$t('agent.ui.reasoning')}: ${reasoningDisplayLabel}`"
                  panel-class="w-56"
                >
                  <template #trigger>
                    <i class="fa-solid fa-bolt text-[9px] text-primary" aria-hidden="true"></i>
                    <span class="agent-config-reasoning min-w-4 whitespace-nowrap text-center">{{
                      reasoningDisplayLabel
                    }}</span>
                    <i
                      v-if="modelSelectionLocked"
                      class="fa-solid fa-lock text-[7px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                    <i
                      v-else
                      class="agent-config-affordance fa-solid fa-chevron-down text-[7px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel>
                    <div class="p-1">
                      <!-- 胶囊条上方纯净居中展示当前强度 -->
                      <div
                        class="mb-1.5 flex items-center justify-center gap-1 text-center text-xs font-semibold text-foreground select-none"
                      >
                        <span>{{ reasoningDisplayLabel }}</span>
                        <i
                          v-if="modelSelectionLocked"
                          class="fa-solid fa-lock text-[9px] text-text-secondary"
                          :title="$t('agent.operations.frozen')"
                          aria-hidden="true"
                        ></i>
                      </div>

                      <!-- 核心主体：精致小巧的 GPT 胶囊滑块条（支持平滑拖拽与吸附） -->
                      <div class="relative my-1.5 px-0.5">
                        <div
                          ref="reasoningTrackRef"
                          class="relative flex h-[26px] w-full items-center rounded-full bg-header/80 px-2 cursor-pointer select-none overflow-hidden border border-border/40 shadow-inner touch-none"
                          @pointerdown="onTrackPointerDown"
                          @pointermove="onTrackPointerMove"
                          @pointerup="onTrackPointerUp"
                          @pointercancel="onTrackPointerCancel"
                        >
                          <!-- 动态填充色带 -->
                          <div
                            class="absolute left-0 top-0 h-full rounded-full pointer-events-none"
                            :class="[
                              isDraggingReasoning ? '' : 'transition-[width] duration-150 ease-out',
                              isUltraOrMax
                                ? 'bg-gradient-to-r from-info via-primary to-warning shadow-[0_0_8px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]'
                                : 'bg-gradient-to-r from-info to-primary',
                            ]"
                            :style="{ width: `${trackFillPercent}%` }"
                          ></div>

                          <!-- 微小精致刻度点 -->
                          <div
                            class="relative z-10 flex w-full items-center justify-between pointer-events-none px-0.5"
                          >
                            <span
                              v-for="(level, idx) in reasoningLevels"
                              :key="level"
                              class="h-1 w-1 rounded-full transition-colors"
                              :class="idx <= activeReasoningIndex ? 'bg-white/90 shadow-2xs' : 'bg-foreground/20'"
                            ></span>
                          </div>

                          <!-- 纯白精致圆形滑钮手柄 -->
                          <div
                            class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-[18px] w-[18px] rounded-full bg-background text-foreground shadow-sm flex items-center justify-center cursor-grab active:cursor-grabbing z-20 ring-1 ring-border/70"
                            :class="
                              isDraggingReasoning
                                ? 'scale-110 shadow-md cursor-grabbing'
                                : 'transition-[left,transform] duration-150 ease-out'
                            "
                            :style="{ left: `${thumbLeftPercent}%` }"
                          >
                            <span
                              class="h-1.5 w-1.5 rounded-full transition-colors"
                              :class="isDraggingReasoning ? 'bg-primary' : 'bg-primary/50'"
                            ></span>
                          </div>
                        </div>
                      </div>

                      <!-- 底部说明文案 -->
                      <div class="mt-1.5 text-center text-[11px] text-text-secondary/80 leading-normal px-1">
                        {{ currentReasoningDescription }}
                      </div>
                    </div>
                  </template>
                </AgentConfigPopover>

                <!-- Run 执行模式：与批准策略正交；plan 模式在 model surface 前移除 mutation Tool -->
                <AgentConfigPopover
                  :ariaLabel="$t('agent.operations.executionMode')"
                  :title="`${$t('agent.operations.executionModeHint')}: ${
                    executionModeValue === 'plan'
                      ? $t('agent.operations.executionPlan')
                      : $t('agent.operations.executionExecute')
                  }`"
                  panel-class="w-72"
                >
                  <template #trigger>
                    <i
                      :class="
                        executionModeValue === 'plan'
                          ? 'fa-solid fa-list-check text-primary'
                          : 'fa-solid fa-play text-success'
                      "
                      class="text-[11px]"
                      aria-hidden="true"
                    ></i>
                    <span class="agent-config-verbose max-w-24 truncate whitespace-nowrap text-left">
                      {{
                        executionModeValue === 'plan'
                          ? $t('agent.operations.executionPlan')
                          : $t('agent.operations.executionExecute')
                      }}
                    </span>
                    <i
                      :class="modelSelectionLocked ? 'fa-solid fa-lock' : 'fa-solid fa-chevron-down'"
                      class="agent-config-affordance text-[11px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel="{ close }">
                    <div class="mb-2 flex items-center justify-between gap-2 px-1">
                      <div class="flex items-center gap-1.5">
                        <span class="text-xs font-semibold">{{ $t('agent.operations.executionMode') }}</span>
                        <UiInfoHint :text="$t('agent.operations.executionModeHint')" />
                      </div>
                      <span
                        v-if="modelSelectionLocked"
                        class="rounded-full bg-header px-2 py-0.5 text-[11px] text-text-secondary"
                      >
                        <i class="fa-solid fa-lock mr-1 text-[7px]" aria-hidden="true"></i
                        >{{ $t('agent.operations.frozen') }}
                      </span>
                    </div>
                    <div class="space-y-1">
                      <button
                        type="button"
                        class="flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors disabled:cursor-default"
                        :class="
                          executionModeValue === 'execute'
                            ? 'border-success/25 bg-success/[0.06] text-foreground'
                            : 'border-transparent text-text-secondary hover:bg-card/70'
                        "
                        :disabled="modelSelectionLocked || busy"
                        @click="
                          setExecutionMode('execute');
                          close(true);
                        "
                      >
                        <span
                          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"
                        >
                          <i class="fa-solid fa-play text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block text-xs font-semibold text-foreground">{{
                            $t('agent.operations.executionExecute')
                          }}</span>
                          <span class="mt-0.5 block text-[11px] leading-4 text-text-secondary">{{
                            $t('agent.operations.executionExecuteDesc')
                          }}</span>
                        </span>
                        <i
                          v-if="executionModeValue === 'execute'"
                          class="fa-solid fa-check mt-1.5 text-[9px] text-success"
                          aria-hidden="true"
                        ></i>
                      </button>
                      <button
                        type="button"
                        class="flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors disabled:cursor-default"
                        :class="
                          executionModeValue === 'plan'
                            ? 'border-primary/25 bg-primary/[0.06] text-foreground'
                            : 'border-transparent text-text-secondary hover:bg-card/70'
                        "
                        :disabled="modelSelectionLocked || busy"
                        @click="
                          setExecutionMode('plan');
                          close(true);
                        "
                      >
                        <span
                          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                        >
                          <i class="fa-solid fa-list-check text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block text-xs font-semibold text-foreground">{{
                            $t('agent.operations.executionPlan')
                          }}</span>
                          <span class="mt-0.5 block text-[11px] leading-4 text-text-secondary">{{
                            $t('agent.operations.executionPlanDesc')
                          }}</span>
                        </span>
                        <i
                          v-if="executionModeValue === 'plan'"
                          class="fa-solid fa-check mt-1.5 text-[9px] text-primary"
                          aria-hidden="true"
                        ></i>
                      </button>
                    </div>
                  </template>
                </AgentConfigPopover>

                <!-- Run 级批准策略：新 Run 创建时冻结，运行中只读 -->
                <AgentConfigPopover
                  :ariaLabel="$t('agent.operations.approvalMode')"
                  :title="`${$t('agent.operations.approvalModeHint')}: ${
                    approvalModeValue === 'full_access'
                      ? $t('agent.operations.approvalFullAccess')
                      : $t('agent.operations.approvalAsk')
                  }`"
                  panel-class="w-72"
                >
                  <template #trigger>
                    <i
                      class="fa-solid fa-shield-halved text-[9px]"
                      :class="approvalModeValue === 'full_access' ? 'text-warning' : 'text-success'"
                      aria-hidden="true"
                    ></i>
                    <span class="agent-config-verbose max-w-24 truncate whitespace-nowrap text-left">
                      {{
                        approvalModeValue === 'full_access'
                          ? $t('agent.operations.approvalFullAccess')
                          : $t('agent.operations.approvalAsk')
                      }}
                    </span>
                    <i
                      :class="modelSelectionLocked ? 'fa-solid fa-lock' : 'fa-solid fa-chevron-down'"
                      class="agent-config-affordance text-[11px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel="{ close }">
                    <div class="mb-2 flex items-center justify-between gap-2 px-1">
                      <div class="flex items-center gap-1.5">
                        <span class="text-xs font-semibold">{{ $t('agent.operations.approvalMode') }}</span>
                        <UiInfoHint :text="$t('agent.operations.approvalModeHint')" />
                      </div>
                      <span
                        v-if="modelSelectionLocked"
                        class="rounded-full bg-header px-2 py-0.5 text-[11px] text-text-secondary"
                      >
                        <i class="fa-solid fa-lock mr-1 text-[7px]" aria-hidden="true"></i
                        >{{ $t('agent.operations.frozen') }}
                      </span>
                    </div>
                    <div class="space-y-1">
                      <button
                        type="button"
                        class="flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors disabled:cursor-default"
                        :class="
                          approvalModeValue === 'ask'
                            ? 'border-success/25 bg-success/[0.06] text-foreground'
                            : 'border-transparent text-text-secondary hover:bg-card/70'
                        "
                        :disabled="modelSelectionLocked || busy"
                        @click="
                          setApprovalMode('ask');
                          close(true);
                        "
                      >
                        <span
                          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"
                        >
                          <i class="fa-solid fa-hand text-[9px] text-success" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block text-xs font-semibold text-foreground">{{
                            $t('agent.operations.approvalAsk')
                          }}</span>
                          <span class="mt-0.5 block text-[11px] leading-4 text-text-secondary">{{
                            $t('agent.operations.approvalAskDesc')
                          }}</span>
                        </span>
                        <i
                          v-if="approvalModeValue === 'ask'"
                          class="fa-solid fa-check mt-1.5 text-[9px] text-success"
                          aria-hidden="true"
                        ></i>
                      </button>
                      <button
                        type="button"
                        class="flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors disabled:cursor-default"
                        :class="
                          approvalModeValue === 'full_access'
                            ? 'border-warning/25 bg-warning/[0.06] text-foreground'
                            : 'border-transparent text-text-secondary hover:bg-card/70'
                        "
                        :disabled="modelSelectionLocked || busy"
                        @click="
                          setApprovalMode('full_access');
                          close(true);
                        "
                      >
                        <span
                          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning"
                        >
                          <i class="fa-solid fa-bolt text-[9px] text-warning" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block text-xs font-semibold text-foreground">{{
                            $t('agent.operations.approvalFullAccess')
                          }}</span>
                          <span class="mt-0.5 block text-[11px] leading-4 text-text-secondary">{{
                            $t('agent.operations.approvalFullAccessDesc')
                          }}</span>
                        </span>
                        <i
                          v-if="approvalModeValue === 'full_access'"
                          class="fa-solid fa-check mt-1.5 text-[9px] text-warning"
                          aria-hidden="true"
                        ></i>
                      </button>
                    </div>
                  </template>
                </AgentConfigPopover>

                <!-- 运行环境 -->
                <AgentConfigPopover
                  :ariaLabel="$t('agent.operations.environment')"
                  :title="`${$t('agent.operations.environmentHint')}: ${environmentLabel}`"
                  panel-class="w-72"
                >
                  <template #trigger>
                    <span class="h-1.5 w-1.5 rounded-full shrink-0" :class="environmentStatusClass"></span>
                    <span class="agent-config-verbose max-w-20 truncate whitespace-nowrap text-left">{{
                      environmentLabel
                    }}</span>
                    <i
                      :class="modelSelectionLocked ? 'fa-solid fa-lock' : 'fa-solid fa-chevron-down'"
                      class="agent-config-affordance text-[11px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel="{ close }">
                    <div class="mb-2 flex items-center justify-between gap-2 px-1">
                      <span class="text-xs font-semibold">{{ $t('agent.operations.environment') }}</span>
                      <span
                        v-if="modelSelectionLocked"
                        class="rounded-full bg-header px-2 py-0.5 text-[11px] text-text-secondary"
                      >
                        <i class="fa-solid fa-lock mr-1 text-[7px]" aria-hidden="true"></i
                        >{{ $t('agent.operations.frozen') }}
                      </span>
                    </div>
                    <div v-if="!modelSelectionLocked" class="max-h-64 space-y-1 overflow-y-auto">
                      <button
                        type="button"
                        class="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors"
                        :class="
                          selectedEnvironmentRecipeId === ''
                            ? 'border border-border/80 bg-card font-medium text-foreground shadow-xs'
                            : 'border border-transparent text-text-secondary hover:bg-card/70'
                        "
                        @click="
                          setEnvironmentSelection('');
                          close(true);
                        "
                      >
                        <span
                          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border"
                          :class="
                            selectedEnvironmentRecipeId === ''
                              ? 'border-border/60 bg-header text-foreground'
                              : 'border-transparent bg-header/60 text-text-secondary'
                          "
                        >
                          <i class="fa-solid fa-terminal text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-xs font-medium text-foreground">{{
                            $t('agent.operations.environmentNone')
                          }}</span>
                          <span class="block truncate text-[11px] text-text-secondary">{{
                            $t('agent.operations.environmentNoneHint')
                          }}</span>
                        </span>
                        <i
                          v-if="selectedEnvironmentRecipeId === ''"
                          class="fa-solid fa-check text-[10px] text-foreground"
                          aria-hidden="true"
                        ></i>
                      </button>

                      <button
                        v-for="recipe in enabledEnvironmentRecipes"
                        :key="recipe.id"
                        type="button"
                        class="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors"
                        :class="
                          selectedEnvironmentRecipeId === recipe.id
                            ? 'border border-border/80 bg-card font-medium text-foreground shadow-xs'
                            : 'border border-transparent text-text-secondary hover:bg-card/70'
                        "
                        @click="
                          setEnvironmentSelection(recipe.id);
                          close(true);
                        "
                      >
                        <span
                          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border"
                          :class="
                            selectedEnvironmentRecipeId === recipe.id
                              ? 'border-border/60 bg-header text-foreground'
                              : 'border-transparent bg-header/60 text-text-secondary'
                          "
                        >
                          <i class="fa-solid fa-box text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-xs font-medium text-foreground">{{
                            recipe.displayName
                          }}</span>
                          <span class="block truncate font-mono text-[11px] text-text-secondary">{{ recipe.id }}</span>
                        </span>
                        <i
                          v-if="selectedEnvironmentRecipeId === recipe.id"
                          class="fa-solid fa-check text-[10px] text-foreground"
                          aria-hidden="true"
                        ></i>
                      </button>
                    </div>
                    <div v-else class="rounded-xl border border-border/60 bg-card/50 p-2.5">
                      <div class="text-xs font-medium text-foreground">
                        {{
                          activeEnvironment
                            ? `${activeEnvironment.recipeId} · ${activeEnvironment.recipeRevision}`
                            : $t('agent.operations.environmentNone')
                        }}
                      </div>
                    </div>
                  </template>
                </AgentConfigPopover>

                <!-- SSH 主机 -->
                <AgentConfigPopover
                  :ariaLabel="$t('agent.operations.targets')"
                  :title="$t('agent.operations.targetsHint')"
                  panel-class="w-[min(320px,calc(100vw-24px))] !rounded-xl !p-2.5 !shadow-xl"
                >
                  <template #trigger>
                    <i
                      class="fa-solid fa-server text-[8px]"
                      :class="displayedConnectionIds.length ? 'text-primary' : 'text-text-secondary'"
                      aria-hidden="true"
                    ></i>
                    <span class="agent-config-verbose whitespace-nowrap">SSH</span>
                    <span class="agent-config-compact hidden whitespace-nowrap">SSH</span>
                    <span
                      class="agent-ssh-count inline-flex min-w-[0.6rem] items-center justify-center text-[11px] font-semibold leading-none"
                      :class="displayedConnectionIds.length ? 'text-success' : 'text-error/80'"
                      >{{ displayedConnectionIds.length }}</span
                    >
                    <i
                      v-if="modelSelectionLocked"
                      class="fa-solid fa-lock text-[7px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                    <i
                      v-else
                      class="agent-config-affordance fa-solid fa-chevron-down text-[7px] text-text-secondary/70"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel>
                    <div class="flex items-start justify-between gap-3 px-1 pb-2 pt-0.5">
                      <div class="min-w-0">
                        <div class="text-[11px] font-semibold leading-tight text-foreground">
                          {{ $t('agent.operations.targets') }}
                        </div>
                        <div class="mt-1 text-[11px] leading-snug text-text-secondary/70">
                          {{ $t('agent.operations.targetsHint') }}
                        </div>
                      </div>
                      <span
                        v-if="modelSelectionLocked"
                        class="shrink-0 rounded-md bg-header/70 px-1.5 py-1 text-[11px] leading-none text-text-secondary"
                      >
                        <i class="fa-solid fa-lock mr-1 text-[7px]" aria-hidden="true"></i
                        >{{ $t('agent.operations.frozen') }}
                      </span>
                    </div>

                    <div
                      v-if="connections.length > 0"
                      class="mb-1.5 flex items-center justify-between gap-2 rounded-lg bg-header/30 px-2 py-1.5"
                    >
                      <div class="flex min-w-0 items-center gap-1.5 text-[11px] text-text-secondary/70">
                        <span
                          class="h-1.5 w-1.5 shrink-0 rounded-full"
                          :class="displayedConnectionIds.length ? 'bg-success' : 'bg-error/75'"
                          aria-hidden="true"
                        ></span>
                        <span class="truncate">{{ $t('agent.operations.targetsRunScope') }}</span>
                        <span
                          class="shrink-0 font-semibold tabular-nums"
                          :class="displayedConnectionIds.length ? 'text-success' : 'text-error/80'"
                        >
                          {{ displayedConnectionIds.length }}/{{ connections.length }}
                        </span>
                      </div>
                      <button
                        type="button"
                        class="grid h-6 w-[54px] shrink-0 grid-cols-3 items-center overflow-hidden rounded-md border border-border/65 bg-background/55 p-0.5 transition-colors disabled:cursor-default disabled:opacity-50"
                        :disabled="modelSelectionLocked"
                        :aria-pressed="
                          connectionSelectionState === 'mixed' ? 'mixed' : connectionSelectionState === 'on'
                        "
                        :aria-label="$t('agent.operations.targetsBulkToggle')"
                        :title="
                          connectionSelectionState === 'on'
                            ? $t('agent.operations.disableAllTargets')
                            : $t('agent.operations.enableAllTargets')
                        "
                        @click="toggleAllConnectionSelections"
                      >
                        <span
                          class="flex h-5 items-center justify-center rounded-[4px] text-[11px] transition-all"
                          :class="
                            connectionSelectionState === 'off' ? 'bg-error/10 text-error/85' : 'text-text-secondary/45'
                          "
                          aria-hidden="true"
                        >
                          <i class="fa-solid fa-xmark"></i>
                        </span>
                        <span
                          class="flex h-5 items-center justify-center rounded-[4px] text-[11px] transition-all"
                          :class="
                            connectionSelectionState === 'mixed'
                              ? 'bg-primary/10 text-primary'
                              : 'text-text-secondary/35'
                          "
                          aria-hidden="true"
                        >
                          <i class="fa-solid fa-minus"></i>
                        </span>
                        <span
                          class="flex h-5 items-center justify-center rounded-[4px] text-[11px] transition-all"
                          :class="
                            connectionSelectionState === 'on' ? 'bg-success/14 text-success' : 'text-text-secondary/45'
                          "
                          aria-hidden="true"
                        >
                          <i class="fa-solid fa-check"></i>
                        </span>
                      </button>
                    </div>

                    <div class="max-h-64 overflow-y-auto rounded-lg bg-header/25 p-1">
                      <button
                        v-for="connection in connections"
                        :key="connection.id"
                        type="button"
                        class="group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors disabled:cursor-default"
                        :class="
                          displayedConnectionIds.includes(connection.id)
                            ? 'bg-background/90 text-foreground shadow-xs'
                            : 'text-text-secondary hover:bg-background/65 hover:text-foreground'
                        "
                        :disabled="modelSelectionLocked"
                        @click="
                          toggleConnectionSelection(connection.id, !displayedConnectionIds.includes(connection.id))
                        "
                      >
                        <span
                          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
                          :class="
                            displayedConnectionIds.includes(connection.id)
                              ? 'bg-primary/10 text-primary'
                              : 'bg-header/65 text-text-secondary/70 group-hover:text-foreground'
                          "
                        >
                          <i class="fa-solid fa-server text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-[11px] font-medium leading-tight text-foreground">{{
                            connection.name || connection.host
                          }}</span>
                          <span class="mt-1 block truncate font-mono text-[11px] leading-none text-text-secondary/60"
                            >{{ connection.host }}:{{ connection.port }}</span
                          >
                        </span>
                        <span
                          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all"
                          :class="
                            displayedConnectionIds.includes(connection.id)
                              ? 'bg-primary text-white shadow-xs'
                              : 'bg-transparent text-transparent ring-1 ring-inset ring-border/55 group-hover:ring-border'
                          "
                          aria-hidden="true"
                        >
                          <i class="fa-solid fa-check text-[8px]"></i>
                        </span>
                      </button>

                      <div
                        v-if="connections.length === 0"
                        class="flex items-center gap-2 rounded-lg px-2.5 py-3 text-[11px] text-text-secondary"
                      >
                        <i class="fa-solid fa-server text-[10px] text-text-secondary/45" aria-hidden="true"></i>
                        <span>{{ $t('agent.operations.noTargets') }}</span>
                      </div>
                    </div>
                  </template>
                </AgentConfigPopover>
              </div>
            </template>
          </AgentConversation>
        </div>
      </div>
    </main>

    <button
      v-if="taskRailVisible"
      type="button"
      class="agent-task-backdrop absolute inset-0 z-20 hidden bg-background/50"
      :aria-label="$t('common.close')"
      @click="taskRailVisible = false"
    ></button>
    <div v-if="taskRailVisible" id="agent-task-rail" class="agent-task-rail min-h-0">
      <TaskRail
        :current="run"
        :background-runs="backgroundRuns"
        :thread-runs="threadRuns"
        :thread-titles="threadTitles"
        :hard-limits="hardLimits"
        :approvals="approvals"
        :approval-clock="approvalBatch?.clock ?? null"
        :current-checkpoints="currentRunCheckpoints"
        :detail-snapshot="detailVisible ? detailSnapshot : null"
        :detail-checkpoints="detailCheckpoints"
        :detail-approvals="detailApprovalBatch?.items ?? []"
        :detail-approval-clock="detailApprovalBatch?.clock ?? null"
        :detail-subagents="detailSubagents"
        :selected-subagent-id="selectedSubagentId"
        :detail-subagent-messages="detailSubagentMessages"
        :busy="mutationLocked"
        @close="taskRailVisible = false"
        @back="closeRunDetail"
        @increase-budget="increaseBudget"
        @resolve-approval="resolveApproval"
        @open-run="openRunDetail"
        @save-checkpoint="saveCheckpoint"
        @resume-checkpoint="resumeCheckpoint"
        @select-subagent="selectSubagent"
        @cancel-subagent="cancelSubagent"
        @delete-run="deleteRun"
      />
    </div>
  </div>
</template>

<style scoped>
  /*
   * §7.2-c: the column widths are variables, so collapsing the thread sidebar is
   * one declaration instead of a restatement in every container-query tier (the
   * tiers below only have to decide whether the rail is docked or an overlay).
   */
  .agent-surface-layout {
    --agent-thread-sidebar-column: 256px;
    --agent-task-rail-column: 0px;
    grid-template-columns: var(--agent-thread-sidebar-column) minmax(0, 1fr) var(--agent-task-rail-column);
    transition: grid-template-columns 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .agent-surface-layout.has-task-rail {
    --agent-task-rail-column: 320px;
  }

  .agent-surface-layout.is-threads-hidden {
    --agent-thread-sidebar-column: 0px;
  }

  /*
   * A zero-width track alone would let the sidebar overflow its column, so the
   * panel is clipped instead; the narrow tier positions it absolutely and never
   * looks at this track, which keeps the two mechanisms from fighting.
   *
   * The clip has to hold while the track animates in either direction, or the
   * panel's min-content width would spill over the conversation pane mid-flight;
   * the fade keeps the reflowing content from looking like a glitch. Both rules
   * live in the docked tier only, because the narrow tier drives the panel with
   * its own transform/visibility pair and must never inherit this opacity.
   *
   * `(width > 760px)` mirrors the `max-width: 760px` overlay tier exactly, so no
   * window falls between them and loses both the docked clip and the drawer.
   */
  @container agent-hub-window (width > 760px) {
    .agent-surface-layout :deep(.agent-thread-sidebar) {
      min-width: 0;
      overflow: hidden;
      transition: opacity 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .agent-surface-layout.is-threads-hidden :deep(.agent-thread-sidebar) {
      opacity: 0;
    }
  }

  .agent-conversation-pane {
    container-type: inline-size;
    container-name: agent-conversation-pane;
  }
  .agent-task-rail {
    position: relative;
  }
  .agent-run-config {
    flex-wrap: nowrap;
    gap: 0.25rem;
    white-space: nowrap;
  }
  /*
   * Keep the line box tall enough for CJK ink. A `line-height: 1` box combined
   * with `truncate` (overflow: hidden) on the inner label clipped the bottom of
   * Chinese glyphs. This scoped rule intentionally owns the line-height instead
   * of relying on a layered `leading-*` utility that cannot override it.
   */
  .agent-config-summary {
    font-size: 11px;
    line-height: 1.3;
  }
  .agent-model-meta {
    display: flex;
  }

  .agent-config-summary::-webkit-details-marker {
    display: none;
  }

  .agent-reasoning-range {
    appearance: none;
    height: 18px;
    background: transparent;
    opacity: 1;
  }

  .agent-reasoning-range::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary) 18%, var(--color-header));
  }

  .agent-reasoning-range::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    margin-top: -5px;
    border: 3px solid var(--color-background);
    border-radius: 999px;
    background: var(--color-primary);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 28%, transparent);
  }

  .agent-reasoning-range::-moz-range-track {
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary) 18%, var(--color-header));
  }

  .agent-reasoning-range::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border: 3px solid var(--color-background);
    border-radius: 999px;
    background: var(--color-primary);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 28%, transparent);
  }

  @container agent-hub-window (max-width: 1180px) {
    .agent-model-meta {
      display: none;
    }
  }

  @container agent-hub-window (max-width: 1040px) {
    .agent-surface-layout,
    .agent-surface-layout.has-task-rail {
      grid-template-columns: var(--agent-thread-sidebar-column) minmax(0, 1fr);
    }

    .agent-task-rail {
      position: absolute;
      inset: 0 0 0 auto;
      width: min(340px, calc(100% - 32px));
      z-index: 30;
      background: var(--color-background);
      box-shadow: -12px 0 32px rgb(0 0 0 / 0.12);
    }
    .agent-task-backdrop {
      display: block;
    }
  }

  /*
   * Configuration density tiers follow the composer width (the composer shell
   * declares the `agent-composer` container), never the conversation pane.
   */
  @container agent-composer (max-width: 730px) {
    .agent-run-config {
      min-width: 0;
      gap: 0.2rem;
    }

    .agent-config-affordance {
      display: none;
    }

    :deep(.agent-config-summary) {
      height: 28px;
      padding-inline: 6px;
      gap: 4px;
      font-size: 11px;
      line-height: 1.25;
    }

    .agent-config-verbose,
    :deep(.agent-config-verbose) {
      max-width: 5.5rem;
    }
  }

  @container agent-composer (max-width: 620px) {
    .agent-config-verbose,
    .agent-config-affordance,
    :deep(.agent-config-verbose),
    :deep(.agent-config-affordance) {
      display: none;
    }

    .agent-config-compact,
    :deep(.agent-config-compact) {
      display: inline;
    }

    :deep(.agent-config-summary) {
      min-width: 28px;
      height: 28px;
      gap: 3px;
      /* Icon-only tier: centre the glyph/dot instead of parking it on the left padding. */
      justify-content: center;
      padding-inline: 6px;
      font-size: 11px;
      line-height: 1.25;
    }

    .agent-config-reasoning {
      width: auto;
      min-width: 0.75rem;
      font-size: 11px;
      line-height: 1.25;
    }
  }

  @container agent-hub-window (max-width: 880px) {
    .agent-run-history {
      display: none;
    }
  }

  @container agent-hub-window (max-width: 760px) {
    .agent-surface-layout,
    .agent-surface-layout.has-task-rail {
      grid-template-columns: minmax(0, 1fr);
    }

    :deep(.agent-thread-sidebar) {
      position: absolute;
      inset: 0 auto 0 0;
      z-index: 30;
      width: min(280px, calc(100% - 48px));
      transform: translateX(-102%);
      visibility: hidden;
      box-shadow: 12px 0 32px rgb(0 0 0 / 0.18);
      transition: transform 160ms ease;
    }

    :deep(.agent-thread-sidebar.is-open) {
      visibility: visible;
      transform: translateX(0);
    }

    :deep(.agent-thread-backdrop.is-open) {
      display: block;
    }

    .agent-header-thread-delete {
      display: flex;
    }

    .agent-config-label {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-surface-layout {
      transition: none;
    }

    :deep(.agent-thread-sidebar) {
      transition: none;
    }
  }

  :deep(.agent-thread-sidebar) ::-webkit-scrollbar {
    width: 4px;
  }
  :deep(.agent-thread-sidebar) ::-webkit-scrollbar-track {
    background: transparent;
  }
  :deep(.agent-thread-sidebar) ::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 9999px;
  }
  :deep(.agent-thread-sidebar) ::-webkit-scrollbar-thumb:hover {
    background: var(--text-color-secondary);
  }
</style>
