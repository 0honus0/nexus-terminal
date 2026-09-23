<script setup lang="ts">
  import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, nextTick, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { logger } from '@/client/logging/logger';
  import { useConnections } from '@/features/connections/public';
  import AgentConversation from '../ai/AgentConversation.vue';
  import {
    createConversationCommandExecutor,
    type ConversationCommandResult,
  } from '../ai/conversation-command-executor';
  import { parseConversationSubmission } from '../ai/conversation-commands';
  import { agentApi, formatAgentApiError } from '../api/agent-api';
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
  import { agentHostEvents } from './agent-host-events';
  import { agentSurfaceSession } from './surface-session';
  import AgentThreadSidebar from './AgentThreadSidebar.vue';
  import AgentConfigPopover from '../files/AgentConfigPopover.vue';
  import ApprovalCard from '../runtime/ApprovalCard.vue';
  import { createAgentRunFacade } from '../runtime/run-facade';
  import { createRuntimeOperationState } from '../runtime/runtime-operation-state';

  const TaskRail = defineAsyncComponent(() => import('../runtime/TaskRail.vue'));

  const props = defineProps<{ appId: string; defaultApprovalMode: AgentApprovalModeDto }>();
  const { t } = useI18n();
  const facade = createAgentRunFacade(props.appId);
  const connectionsStore = useConnections();
  facade.start();
  const runtimeOperation = createRuntimeOperationState();
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
  const error = ref('');
  let currentRunCheckpointsGeneration = 0;

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
    } catch (cause) {
      if (requestGeneration !== currentRunCheckpointsGeneration || run.value?.id !== runId) return;
      currentRunCheckpoints.value = [];
      logger.warn({ err: cause, appId: props.appId, runId }, 'Agent UI failed to refresh current Run checkpoints');
      error.value = explain(cause);
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
  const taskRailVisible = ref(false);
  const threadDeleteArmedId = ref<string | null>(null);
  const deleteAllThreadsArmed = ref(false);
  const threadSidebarVisible = ref(false);
  const threadSidebar = ref<InstanceType<typeof AgentThreadSidebar> | null>(null);
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
  const draft = ref(agentSurfaceSession.state(props.appId).draft);
  const commandResult = ref<ConversationCommandResult | null>(null);
  let threadSelectionGeneration = 0;
  let threadListRefreshGeneration = 0;
  let ledgerGeneration = 0;
  let approvalsGeneration = 0;
  let reconciliationGeneration = 0;
  let backgroundGeneration = 0;
  let detailSubagentsGeneration = 0;
  let detailOpenGeneration = 0;
  let subagentMessagesGeneration = 0;
  let threadDeleteArmTimer: number | null = null;
  let deleteAllThreadsArmTimer: number | null = null;

  const nonTerminal = new Set([
    'created',
    'running',
    'awaiting_approval',
    'awaiting_budget',
    'awaiting_input',
    'cancelling',
  ]);
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
        return status !== null && nonTerminal.has(status);
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
  const modelSelectionLocked = computed(() => Boolean(run.value && nonTerminal.has(run.value.status)));
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
    const submission = parseConversationSubmission(draft.value);
    if (submission.kind === 'invalid_command') return true;
    if (submission.kind === 'command') {
      if (submission.command.kind === 'help') return true;
      if (run.value) return true;
      return submission.command.kind === 'goal.set' ? Boolean(definitions.value[0] && providerSelection.value) : true;
    }
    return Boolean(
      (run.value && nonTerminal.has(run.value.status)) || (definitions.value[0] && providerSelection.value),
    );
  });

  const explain = (cause: unknown): string => formatAgentApiError(cause, 'AGENT_REQUEST_FAILED');

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
    } catch (cause) {
      if (requestGeneration !== reconciliationGeneration || run.value?.id !== runId) return;
      reconciliationDetails.value = null;
      error.value = explain(cause);
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
      if (reportFailure) error.value = explain(cause);
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
      (candidate) => nonTerminal.has(candidate.status) && candidate.threadId !== selectedThreadId,
    );
  };

  const recoverRuntimeFailure = async (cause: unknown, runId?: string): Promise<void> => {
    const decision = runtimeOperation.fail(cause);
    error.value = explain(cause);
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

  const resolveReconciliation = async (note: string): Promise<void> => {
    const currentRun = run.value;
    const details = reconciliationDetails.value;
    const normalizedNote = note.trim();
    if (!currentRun?.needsReconciliation || !details?.required || !normalizedNote || reconciliationBusy.value) return;

    reconciliationBusy.value = true;
    error.value = '';
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
          error.value = t('agent.operations.restartRecoveryFailed', {
            reasons: event.payload.reasons.join(', '),
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
        if (!next || !nonTerminal.has(next.status)) {
          resetStreamingPresentation();
          facade.selectRun(null);
        }
      },
      onError: (cause) => {
        logger.warn(
          { appId: props.appId, runId: initial.id, threadId: initial.threadId, err: cause },
          'Agent UI run stream failed',
        );
        error.value = explain(cause);
      },
    });
  };

  const selectThread = async (thread: AgentThreadViewDto): Promise<void> => {
    threadSidebarVisible.value = false;
    if (currentThread.value?.id === thread.id) return;
    const selectionGeneration = ++threadSelectionGeneration;
    stopRunStream();
    currentThread.value = thread;
    entries.value = [];
    run.value = null;
    reconciliationDetails.value = null;
    threadRuns.value = [];
    approvalBatch.value = null;
    nextCursor.value = null;
    error.value = '';
    runtimeOperation.succeed();
    commandResult.value = null;
    agentSurfaceSession.setThread(props.appId, thread.id);
    selectingThread.value = true;
    try {
      await refreshLedger();
      if (selectionGeneration !== threadSelectionGeneration || currentThread.value?.id !== thread.id) return;
      const runs = await facade.listRuns(thread.id);
      if (selectionGeneration !== threadSelectionGeneration || currentThread.value?.id !== thread.id) return;
      threadRuns.value = runs.items;
      const selectedRun = runs.items.find((candidate) => nonTerminal.has(candidate.status)) ?? runs.items[0] ?? null;
      const active =
        selectedRun && !nonTerminal.has(selectedRun.status) ? await facade.getRun(selectedRun.id) : selectedRun;
      if (selectionGeneration !== threadSelectionGeneration || currentThread.value?.id !== thread.id) return;
      run.value = active;
      if (active) rememberThreadRun(active);
      if (active?.needsReconciliation) {
        runtimeOperation.markReconciling('RECONCILIATION_REQUIRED', t('agent.operations.reconciliationRequired'));
        await refreshReconciliation(active.id);
      } else {
        reconciliationDetails.value = null;
      }
      await refreshApprovals(active?.id);
      if (selectionGeneration !== threadSelectionGeneration || currentThread.value?.id !== thread.id) return;
      if (active && nonTerminal.has(active.status)) startRunStream(active);
      await refreshBackgroundRuns();
    } catch (cause) {
      if (selectionGeneration === threadSelectionGeneration) error.value = explain(cause);
    } finally {
      if (selectionGeneration === threadSelectionGeneration) selectingThread.value = false;
    }
  };

  const refreshThreadListFromHost = async (): Promise<void> => {
    const requestGeneration = ++threadListRefreshGeneration;
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

  const createThread = async (title?: string): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      const normalizedTitle = title?.trim();
      const thread = await facade.createThread(normalizedTitle || undefined);
      threads.value = [thread, ...threads.value.filter((item) => item.id !== thread.id)];
      threadSidebar.value?.resetScroll();
      await selectThread(thread);
    } catch (cause) {
      error.value = explain(cause);
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
    threadListLoadingMore.value = true;
    try {
      const page = await facade.listThreads(cursor, threadPageSize.value);
      const known = new Set(threads.value.map((thread) => thread.id));
      threads.value = [...threads.value, ...page.items.filter((thread) => !known.has(thread.id))];
      threadNextCursor.value = page.nextCursor;
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      threadListLoadingMore.value = false;
    }
  };

  const loadRunConfiguration = async (): Promise<void> => {
    const [nextDefinitions, nextProviders, settings, , runtimeAvailability, nextDenylist] = await Promise.all([
      facade.definitions(),
      facade.providers(),
      facade.settings(),
      connectionsStore.revalidate(0),
      agentApi.workspaceRuntimeAvailability().catch(() => null),
      agentApi.targetDenylist(),
    ]);
    definitions.value = nextDefinitions;
    providers.value = nextProviders;
    settingsView.value = settings;
    targetDenylist.value = nextDenylist;
    workspaceRuntimeAvailability.value = runtimeAvailability;
    workspaceRuntimeCatalog.value = runtimeAvailability?.available
      ? await agentApi.workspaceRuntimeCatalog().catch(() => null)
      : null;
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
  };

  const load = async (): Promise<void> => {
    loading.value = true;
    error.value = '';
    const configurationPromise = loadRunConfiguration().catch((cause) => {
      error.value = explain(cause);
    });
    try {
      const threadPage = await facade.listThreads(undefined, threadPageSize.value);
      threads.value = threadPage.items;
      threadNextCursor.value = threadPage.nextCursor;
      const restored = agentSurfaceSession.restoreThread(props.appId);
      const selected = threads.value.find((thread) => thread.id === restored) ?? threads.value[0];
      if (selected) await selectThread(selected);
      else await createThread();
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      loading.value = false;
    }
    void configurationPromise;
  };

  const beginRuntimeMutation = (): boolean => {
    if (mutationLocked.value) return false;
    busy.value = true;
    runtimeOperation.beginMutation();
    error.value = '';
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
    const created = await facade.createRun({
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
    });
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

  const adoptCommandRun = (candidate: AgentRunViewDto): void => {
    if (currentThread.value?.id !== candidate.threadId || run.value?.id !== candidate.id) return;
    run.value = candidate;
    rememberThreadRun(candidate);
  };

  const executeSlashCommand = createConversationCommandExecutor({
    t: (key, values) => (values ? t(key, values) : t(key)),
    getRun: () => run.value,
    isActiveRun: (candidate) => nonTerminal.has(candidate.status) && candidate.status !== 'cancelling',
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
    if (submission.kind === 'command') {
      await executeSlashCommand(submission.command, selectedArtifacts);
      return;
    }
    commandResult.value = null;
    if (!currentThread.value || !beginRuntimeMutation()) return;
    try {
      const active = run.value;
      if (active && nonTerminal.has(active.status)) {
        const artifactRefs = await resolveArtifactRefs(selectedArtifacts, active);
        await facade.appendInput(active, submission.text, artifactRefs);
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
      await Promise.all([refreshLedger(), refreshApprovals(run.value.id), refreshBackgroundRuns()]);
      runtimeOperation.succeed();
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
      await Promise.all([refreshLedger(), refreshApprovals(run.value.id), refreshBackgroundRuns()]);
      if (run.value && nonTerminal.has(run.value.status)) startRunStream(run.value);
      runtimeOperation.succeed();
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
      const next = await refreshRun(approval.runId);
      await Promise.all([
        refreshApprovals(approval.runId),
        refreshLedger(),
        refreshBackgroundRuns(),
        ...(detailVisible.value && detailSnapshot.value?.id === approval.runId
          ? [refreshDetailApprovalBatch(approval.runId)]
          : []),
      ]);
      if (next && nonTerminal.has(next.status)) startRunStream(next);
      runtimeOperation.succeed();
    } catch (cause) {
      await recoverRuntimeFailure(cause, approval.runId);
    } finally {
      finishRuntimeMutation();
    }
  };

  const refreshDetailApprovalBatch = async (runId: string): Promise<void> => {
    try {
      const [next, snapshot] = await Promise.all([facade.listApprovals(runId), facade.getRun(runId)]);
      if (!detailVisible.value || detailSnapshot.value?.id !== runId) return;
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
      error.value = explain(cause);
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
      detailCheckpoints.value = [];
      detailApprovalBatch.value = null;
      detailSubagents.value = [];
      selectedSubagentId.value = null;
      detailSubagentMessages.value = [];
      detailVisible.value = true;

      const [checkpoints, detailApprovals, subagents] = await auxiliary;
      if (requestGeneration !== detailOpenGeneration || detailSnapshot.value?.id !== candidate.id) return;
      if (checkpoints.status === 'fulfilled') detailCheckpoints.value = checkpoints.value;
      if (detailApprovals.status === 'fulfilled') detailApprovalBatch.value = detailApprovals.value;
      if (subagents.status === 'fulfilled') detailSubagents.value = subagents.value.items;
      const failure = [checkpoints, detailApprovals, subagents].find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failure) error.value = explain(failure.reason);
    } catch (cause) {
      if (requestGeneration !== detailOpenGeneration) return;
      error.value = explain(cause);
    }
  };

  const closeRunDetail = (): void => {
    detailOpenGeneration += 1;
    detailSubagentsGeneration += 1;
    subagentMessagesGeneration += 1;
    detailVisible.value = false;
    detailApprovalBatch.value = null;
  };

  const saveCheckpoint = async (snapshot: AgentRunSnapshotDto | AgentRunViewDto): Promise<void> => {
    if (!beginRuntimeMutation()) return;
    try {
      await facade.saveCheckpoint(snapshot as AgentRunSnapshotDto);
      const cps = await facade.listCheckpoints(snapshot.id);
      detailCheckpoints.value = cps;
      if (run.value?.id === snapshot.id) {
        currentRunCheckpoints.value = cps;
      }
      runtimeOperation.succeed();
    } catch (cause) {
      await recoverRuntimeFailure(cause, snapshot.id);
    } finally {
      finishRuntimeMutation();
    }
  };

  const resumeCheckpoint = async (
    snapshot: AgentRunSnapshotDto | AgentRunViewDto,
    checkpoint: AgentCheckpointViewDto,
  ): Promise<void> => {
    if (!beginRuntimeMutation()) return;
    try {
      const resumed = await facade.resumeRun(snapshot, checkpoint.id);
      run.value = resumed;
      rememberThreadRun(resumed);
      detailSnapshot.value = await facade.getRun(resumed.id);
      detailCheckpoints.value = [];
      detailVisible.value = false;
      await Promise.all([refreshLedger(), refreshApprovals(resumed.id), refreshBackgroundRuns()]);
      startRunStream(resumed);
      runtimeOperation.succeed();
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
        const page = await facade.listRuns(snapshot.threadId);
        threadRuns.value = page.items;
        if (run.value?.id === snapshot.id) {
          stopRunStream();
          run.value = page.items.find((candidate) => nonTerminal.has(candidate.status)) ?? page.items[0] ?? null;
          await refreshApprovals(run.value?.id);
          if (run.value && nonTerminal.has(run.value.status)) startRunStream(run.value);
        }
        await refreshLedger();
      }
      await refreshBackgroundRuns();
      runtimeOperation.succeed();
    } catch (cause) {
      error.value = explain(cause);
      runtimeOperation.fail(cause);
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
    error.value = '';
    clearThreadDeleteArm();
    try {
      const deletingCurrent = currentThread.value?.id === thread.id;
      await facade.deleteThread(thread);
      threads.value = threads.value.filter((candidate) => candidate.id !== thread.id);
      if (detailSnapshot.value?.threadId === thread.id) closeRunDetail();
      if (deletingCurrent) {
        resetDeletedThreadSelection();
        clearComposer(true);
        await selectFirstOrCreateThread();
      }
      await refreshBackgroundRuns();
      runtimeOperation.succeed();
    } catch (cause) {
      error.value = explain(cause);
      runtimeOperation.fail(cause);
    } finally {
      busy.value = false;
    }
  };

  const requestDeleteThread = (thread: AgentThreadViewDto): void => {
    const status = threadStatus(thread.id);
    if (status && nonTerminal.has(status)) return;
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
    error.value = '';
    clearDeleteAllThreadsArm();
    clearThreadDeleteArm();
    try {
      await facade.deleteAllThreads();
      closeRunDetail();
      resetDeletedThreadSelection();
      backgroundRuns.value = [];
      threadSidebar.value?.resetScroll();
      clearComposer(true);
      await selectFirstOrCreateThread();
      runtimeOperation.succeed();
    } catch (cause) {
      error.value = explain(cause);
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
    const [nextDenylist] = await Promise.all([agentApi.targetDenylist(), connectionsStore.revalidate(0)]);
    targetDenylist.value = nextDenylist;
  };

  const refreshConnectionsOnFocus = (): void => {
    void refreshConnectionsAndAuthorization().catch(() => undefined);
  };

  const onAuthorizationChanged = (): void => {
    void refreshConnectionsAndAuthorization().catch(() => undefined);
  };

  let stopThreadChanged = (): void => {};
  let stopAuthorizationChanged = (): void => {};
  onMounted(() => {
    window.addEventListener('focus', refreshConnectionsOnFocus);
    stopThreadChanged = agentHostEvents.on('thread-changed', onThreadChanged);
    stopAuthorizationChanged = agentHostEvents.on('authorization-changed', onAuthorizationChanged);
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
    facade.dispose();
    resetStreamingPresentation();
  });
</script>

<template>
  <div class="agent-surface-layout relative grid h-full min-h-0" :class="{ 'has-task-rail': taskRailVisible }">
    <AgentThreadSidebar
      ref="threadSidebar"
      :open="threadSidebarVisible"
      :threads="threads"
      :next-cursor="threadNextCursor"
      :loading-more="threadListLoadingMore"
      :active-thread-count="activeThreadCount"
      :busy="busy"
      :current-thread-id="currentThread?.id ?? null"
      :thread-statuses="threadStatuses"
      :thread-delete-armed-id="threadDeleteArmedId"
      :delete-all-threads-armed="deleteAllThreadsArmed"
      @close="threadSidebarVisible = false"
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
              class="agent-thread-toggle hidden h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card text-text-secondary hover:bg-header hover:text-foreground transition-colors"
              :aria-label="$t('agent.operations.openThreads')"
              @click="threadSidebarVisible = true"
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
                run && nonTerminal.has(run.status)
                  ? $t('agent.operations.deleteThreadActiveHint')
                  : threadDeleteArmedId === currentThread.id
                    ? $t('agent.operations.confirmDeleteThread')
                    : $t('agent.operations.deleteThread')
              "
              :disabled="busy || Boolean(run && nonTerminal.has(run.status))"
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
        <div v-if="loading || selectingThread" class="flex h-full items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-text-secondary">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-card text-foreground"
            >
              <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
            </div>
            <span class="text-xs">{{ $t('agent.operations.loading') }}</span>
          </div>
        </div>
        <div
          v-else-if="error && entries.length === 0"
          class="flex h-full items-center justify-center p-6 text-center text-sm text-error"
        >
          <div class="max-w-sm rounded-xl border border-error/30 bg-error/10 px-4 py-3">{{ error }}</div>
        </div>
        <div v-else class="relative h-full min-h-0">
          <AgentConversation
            :app-id="appId"
            :error="error"
            :reconciliation="run?.needsReconciliation === true || runtimeOperation.phase.value === 'reconciling'"
            :reconciliation-details="reconciliationDetails"
            :reconciliation-busy="reconciliationBusy"
            @dismiss-error="error = ''"
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
                          <span class="mt-0.5 block truncate text-[9px] text-text-secondary">
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
                      <div>
                        <div class="text-xs font-semibold">{{ $t('agent.operations.executionMode') }}</div>
                        <div class="mt-1 text-[11px] leading-4 text-text-secondary">
                          {{ $t('agent.operations.executionModeHint') }}
                        </div>
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
                      <div>
                        <div class="text-xs font-semibold">{{ $t('agent.operations.approvalMode') }}</div>
                        <div class="mt-1 text-[11px] leading-4 text-text-secondary">
                          {{ $t('agent.operations.approvalModeHint') }}
                        </div>
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
  .agent-surface-layout {
    grid-template-columns: 256px minmax(0, 1fr);
  }

  .agent-conversation-pane {
    container-type: inline-size;
    container-name: agent-conversation-pane;
  }

  .agent-surface-layout.has-task-rail {
    grid-template-columns: 256px minmax(0, 1fr) 320px;
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
   * Chinese glyphs; this is an unlayered scoped rule, so the `leading-*`
   * utility on the element could never win (see doc/problem.md §7.10).
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
      grid-template-columns: 256px minmax(0, 1fr);
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

    .agent-thread-toggle,
    .agent-header-thread-delete {
      display: flex;
    }

    .agent-config-label {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
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
