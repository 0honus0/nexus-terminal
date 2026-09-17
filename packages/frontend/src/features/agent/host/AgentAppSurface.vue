<script setup lang="ts">
  import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, nextTick, watch } from 'vue';
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
    AgentApprovalMode,
    AgentApprovalBatch,
    AgentApprovalView,
    AgentCheckpointView,
    AgentArtifactRef,
    AgentDefinitionView,
    AgentHardLimits,
    AgentLedgerEntry,
    AgentProviderView,
    AgentReasoningEffort,
    AgentRunReconciliationView,
    AgentRunSnapshot,
    AgentRunView,
    AgentSettingsView,
    AgentSubagentMessage,
    AgentSubagentView,
    AgentThreadView,
    TargetDenylistView,
    WorkspaceRuntimeAvailability,
    WorkspaceRuntimeCatalog,
  } from '../api/agent-api';
  import { agentSurfaceSession } from './surface-session';
  import AgentConfigPopover from '../files/AgentConfigPopover.vue';
  import ApprovalCard from '../runtime/ApprovalCard.vue';
  import { createAgentRunFacade } from '../runtime/run-facade';
  import { createRuntimeOperationState } from '../runtime/runtime-operation-state';

  const TaskRail = defineAsyncComponent(() => import('../runtime/TaskRail.vue'));

  const props = defineProps<{ appId: string; defaultApprovalMode: AgentApprovalMode }>();
  const { t, locale } = useI18n();
  const facade = createAgentRunFacade(props.appId);
  const connectionsStore = useConnections();
  facade.start();
  const runtimeOperation = createRuntimeOperationState();
  const threads = ref<AgentThreadView[]>([]);
  const threadNextCursor = ref<string | null>(null);
  const threadListLoadingMore = ref(false);
  const THREAD_PAGE_MIN = 12;
  const THREAD_PAGE_MAX = 100;
  const currentThread = ref<AgentThreadView | null>(null);
  const entries = ref<AgentLedgerEntry[]>([]);
  const nextCursor = ref<string | null>(null);
  const run = ref<AgentRunView | null>(null);
  const reconciliationDetails = ref<AgentRunReconciliationView | null>(null);
  const reconciliationBusy = ref(false);
  const threadRuns = ref<AgentRunView[]>([]);
  const definitions = ref<AgentDefinitionView[]>([]);
  const providers = ref<AgentProviderView[]>([]);
  const targetDenylist = ref<TargetDenylistView | null>(null);
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
  const attachments = ref<AgentArtifactRef[]>([]);
  const approvalBatch = ref<AgentApprovalBatch | null>(null);
  const approvals = computed(() => approvalBatch.value?.items ?? []);
  const pendingApprovals = computed(() => approvals.value.filter((approval) => approval.status === 'requested'));
  const hardLimits = ref<AgentHardLimits | null>(null);
  const settingsView = ref<AgentSettingsView | null>(null);
  const workspaceRuntimeAvailability = ref<WorkspaceRuntimeAvailability | null>(null);
  const workspaceRuntimeCatalog = ref<WorkspaceRuntimeCatalog | null>(null);
  const backgroundRuns = ref<AgentRunView[]>([]);
  const detailSnapshot = ref<AgentRunSnapshot | null>(null);
  const detailCheckpoints = ref<AgentCheckpointView[]>([]);
  const currentRunCheckpoints = ref<AgentCheckpointView[]>([]);
  const detailApprovalBatch = ref<AgentApprovalBatch | null>(null);

  const refreshCurrentCheckpoints = async (): Promise<void> => {
    if (!run.value) {
      currentRunCheckpoints.value = [];
      return;
    }
    try {
      currentRunCheckpoints.value = await facade.listCheckpoints(run.value.id);
    } catch {
      currentRunCheckpoints.value = [];
    }
  };

  watch(
    () => run.value?.id,
    () => {
      void refreshCurrentCheckpoints();
    },
    { immediate: true },
  );
  const detailSubagents = ref<AgentSubagentView[]>([]);
  const selectedSubagentId = ref<string | null>(null);
  const detailSubagentMessages = ref<AgentSubagentMessage[]>([]);
  const detailVisible = ref(false);
  const selectedModelKey = ref('');
  const selectedReasoningEffort = ref<AgentReasoningEffort | null>(
    agentSurfaceSession.restoreReasoningEffort(props.appId) ?? null,
  );
  const selectedApprovalMode = ref<AgentApprovalMode>(
    agentSurfaceSession.restoreApprovalMode(props.appId) ?? props.defaultApprovalMode,
  );
  const selectedEnvironmentRecipeId = ref(agentSurfaceSession.restoreEnvironmentRecipeId(props.appId) ?? '');
  let taskRailWideViewport = typeof window !== 'undefined' ? window.innerWidth > 1040 : false;
  const taskRailVisible = ref(false);
  const threadQuery = ref('');
  const threadDeleteArmedId = ref<string | null>(null);
  const deleteAllThreadsArmed = ref(false);
  const threadSidebarVisible = ref(false);
  const threadListScroller = ref<HTMLElement | null>(null);
  const threadListScrollTop = ref(0);
  const threadListViewportHeight = ref(0);
  const THREAD_ROW_BASE_HEIGHT = 45;
  const THREAD_LIST_SCALE_MIN = 0.8;
  const THREAD_LIST_SCALE_MAX = 1.3;
  const THREAD_LIST_SCALE_STEP = 0.1;
  const THREAD_LIST_SCALE_STORAGE_KEY = 'nexus.agent.thread-list-scale.v1';
  const restoreThreadListScale = (): number => {
    if (typeof window === 'undefined') return 1;
    try {
      const stored = window.localStorage.getItem(THREAD_LIST_SCALE_STORAGE_KEY);
      if (!stored) return 1;
      const parsed = Number(stored);
      if (!Number.isFinite(parsed)) return 1;
      return Math.min(THREAD_LIST_SCALE_MAX, Math.max(THREAD_LIST_SCALE_MIN, parsed));
    } catch {
      return 1;
    }
  };
  const threadListScale = ref(restoreThreadListScale());
  const threadRowHeight = computed(() => Math.round(THREAD_ROW_BASE_HEIGHT * threadListScale.value));
  const THREAD_OVERSCAN = 6;
  const threadPageSize = computed(() => {
    const viewportHeight = threadListViewportHeight.value;
    const visibleRows = viewportHeight > 0 ? Math.ceil(viewportHeight / threadRowHeight.value) : THREAD_PAGE_MIN;
    return Math.min(THREAD_PAGE_MAX, Math.max(THREAD_PAGE_MIN, visibleRows + THREAD_OVERSCAN * 2));
  });
  let threadListResizeObserver: ResizeObserver | null = null;
  const streamingText = ref('');
  const busy = ref(false);
  const loading = ref(true);
  const selectingThread = ref(false);
  const error = ref('');
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

  const nonTerminal = new Set(['created', 'running', 'awaiting_approval', 'awaiting_budget', 'awaiting_input', 'cancelling']);
  const backgroundThreadStatuses = computed(() => {
    const statuses = new Map<string, AgentRunView['status']>();
    for (const candidate of backgroundRuns.value) {
      if (!statuses.has(candidate.threadId)) statuses.set(candidate.threadId, candidate.status);
    }
    return statuses;
  });
  const threadStatus = (threadId: string): AgentRunView['status'] | null => {
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
  const visibleThreads = computed(() => {
    const needle = threadQuery.value.trim().toLowerCase();
    return threads.value
      .filter((thread) => !needle || `${thread.title} ${thread.id}`.toLowerCase().includes(needle))
      .slice()
      .sort((left, right) => {
        const leftStatus = threadStatus(left.id);
        const rightStatus = threadStatus(right.id);
        const leftActive = leftStatus !== null && nonTerminal.has(leftStatus);
        const rightActive = rightStatus !== null && nonTerminal.has(rightStatus);
        if (leftActive !== rightActive) return leftActive ? -1 : 1;
        return right.updatedAt - left.updatedAt;
      });
  });
  const threadWindow = computed(() => {
    const total = visibleThreads.value.length;
    if (total === 0) return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };
    const rowHeight = threadRowHeight.value;
    const viewportRows = Math.max(1, Math.ceil(threadListViewportHeight.value / rowHeight));
    const windowSize = Math.min(total, viewportRows + THREAD_OVERSCAN * 2);
    const rawStart = Math.floor(threadListScrollTop.value / rowHeight) - THREAD_OVERSCAN;
    const start = Math.min(Math.max(0, rawStart), Math.max(0, total - windowSize));
    const end = Math.min(total, start + windowSize);
    return {
      start,
      end,
      topSpacer: start * rowHeight,
      bottomSpacer: (total - end) * rowHeight,
    };
  });
  const renderedThreads = computed(() => visibleThreads.value.slice(threadWindow.value.start, threadWindow.value.end));
  const threadTitles = computed<Record<string, string>>(() =>
    Object.fromEntries(
      threads.value.map((thread) => [thread.id, thread.title || t('agent.operations.untitledThread')]),
    ),
  );
  const threadTimeFormatter = computed(
    () =>
      new Intl.DateTimeFormat(locale.value, {
        hour: '2-digit',
        minute: '2-digit',
      }),
  );
  const threadDateFormatter = computed(
    () =>
      new Intl.DateTimeFormat(locale.value, {
        month: 'short',
        day: 'numeric',
      }),
  );
  const formatThreadUpdatedAt = (updatedAt: number): string => {
    const date = new Date(updatedAt * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    return isToday ? threadTimeFormatter.value.format(date) : threadDateFormatter.value.format(date);
  };
  const modelOptions = computed(() =>
    providers.value
      .filter((provider) => provider.enabled)
      .flatMap((provider) =>
        provider.models.map((model) => ({
          key: `${provider.id}\u0000${model.id}\u0000${provider.version}`,
          provider,
          model,
        })),
      ),
  );
  const providerSelection = computed(
    () =>
      modelOptions.value.find((candidate) => candidate.key === selectedModelKey.value) ?? modelOptions.value[0] ?? null,
  );
  const modelSelectionLocked = computed(() => Boolean(run.value && nonTerminal.has(run.value.status)));
  const approvalModeValue = computed<AgentApprovalMode>(() =>
    modelSelectionLocked.value ? (run.value?.definition.approvalMode ?? 'ask') : selectedApprovalMode.value,
  );
  const setApprovalMode = (mode: AgentApprovalMode): void => {
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
  const reasoningLevels = computed<AgentReasoningEffort[]>(() => reasoningModel.value?.reasoningEfforts ?? []);
  const reasoningCapabilityAvailable = computed(() => reasoningLevels.value.length > 0);
  const reasoningValue = computed<AgentReasoningEffort | null>(() =>
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
  const reasoningLevelLabel = (level: AgentReasoningEffort): string => t(`agent.ui.reasoningLevels.${level}`);
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
  const activeRunProviderName = computed(() => {
    const providerId = run.value?.definition.model.providerId;
    return providers.value.find((provider) => provider.id === providerId)?.displayName ?? providerId ?? '';
  });
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
  const environmentToolDefaults = computed(() => {
    const versions = settingsView.value?.effectiveSettings.workspaceRuntime.toolVersions ?? {};
    return Object.entries(versions)
      .filter(([, config]) => Boolean(config.defaultVersionId))
      .map(([familyId, config]) => `${familyId}@${config.defaultVersionId}`)
      .sort();
  });
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

  const rememberThreadRun = (candidate: AgentRunView): void => {
    if (currentThread.value?.id !== candidate.threadId) return;
    threadRuns.value = [candidate, ...threadRuns.value.filter((item) => item.id !== candidate.id)].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
  };

  const setModelSelection = (key: string): void => {
    if (modelSelectionLocked.value) return;
    const option = modelOptions.value.find((candidate) => candidate.key === key);
    if (!option) return;
    selectedModelKey.value = option.key;
    agentSurfaceSession.setModelKey(props.appId, option.key);
    const nextEffort = option.model.defaultReasoningEffort ?? null;
    selectedReasoningEffort.value = nextEffort;
    agentSurfaceSession.setReasoningEffort(props.appId, nextEffort ?? undefined);
  };

  const setReasoningEffort = (effort: AgentReasoningEffort): void => {
    if (modelSelectionLocked.value || !reasoningLevels.value.includes(effort)) return;
    selectedReasoningEffort.value = effort;
    agentSurfaceSession.setReasoningEffort(props.appId, effort);
  };

  const setReasoningIndex = (value: string): void => {
    const effort = reasoningLevels.value[Number(value)];
    if (effort) setReasoningEffort(effort);
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

  const openRunFromHistory = (runId: string): void => {
    const candidate = threadRuns.value.find((item) => item.id === runId);
    if (candidate) void openRunDetail(candidate);
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

  const refreshRun = async (runId: string, minimumEventCursor = 0): Promise<AgentRunSnapshot | null> => {
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
    } catch {
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
    const next = await refreshRun(targetRunId);
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
    streamingText.value = '';
  };

  const startRunStream = (initial: AgentRunView): void => {
    streamingText.value = '';
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
        if (event.type === 'transport.disconnected') streamingText.value = '';
        if (event.type === 'message.delta') {
          if (!event.payload.delegationId) streamingText.value += event.payload.text;
          return;
        }
        if (event.type === 'tool.delta') return;
        if (event.type === 'message.final') streamingText.value = '';
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
          ...(detailVisible.value && detailSnapshot.value?.id === initial.id
            ? [refreshDetailSubagents(initial.id), refreshDetailApprovalBatch(initial.id)]
            : []),
        ]);
        if (signal.aborted) return;
        if (!next || !nonTerminal.has(next.status)) {
          streamingText.value = '';
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

  const selectThread = async (thread: AgentThreadView): Promise<void> => {
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

  const onThreadChanged = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return;
    const payload = detail as Record<string, unknown>;
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
      resetThreadListScroll();
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
    const restoredModel = modelOptions.value.find((candidate) => candidate.key === restoredModelKey);
    const preferredModel = modelOptions.value.find(
      (candidate) =>
        candidate.provider.id === settings.effectiveSettings.model.defaultProviderId &&
        candidate.model.id === settings.effectiveSettings.model.defaultModelId,
    );
    const selectedModel = restoredModel ?? preferredModel ?? modelOptions.value[0] ?? null;
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

  const resolveArtifactRefs = async (artifacts: AgentArtifactRef[], activeRun?: AgentRunView): Promise<string[]> => {
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
    selectedArtifacts: AgentArtifactRef[] = [],
    initialGoal?: string,
  ): Promise<AgentRunView> => {
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
        inputBytes: new TextEncoder().encode(text).byteLength,
        artifactCount: artifactRefs.length,
        connectionCount: selectedConnectionIds.value.length,
        environmentRecipeId: selectedEnvironmentRecipe.value?.id ?? null,
      },
      'Agent UI creating run',
    );
    const created = await facade.createRun({
      threadId: thread.id,
      text,
      artifactRefs,
      agentDefinitionId: definition.id,
      model: {
        providerId: selection.provider.id,
        modelId: selection.model.id,
        configurationVersion: selection.provider.version,
      },
      ...(selectedReasoningEffort.value === null ? {} : { reasoningEffort: selectedReasoningEffort.value }),
      approvalMode: selectedApprovalMode.value,
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
        approvalMode: created.definition.approvalMode ?? 'ask',
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

  const adoptCommandRun = (candidate: AgentRunView): void => {
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

  const send = async (text: string, selectedArtifacts: AgentArtifactRef[]): Promise<void> => {
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
    approval: AgentApprovalView,
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

  const selectSubagent = async (delegation: AgentSubagentView): Promise<void> => {
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

  const cancelSubagent = async (delegation: AgentSubagentView): Promise<void> => {
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

  const openRunDetail = async (candidate: AgentRunView): Promise<void> => {
    const requestGeneration = ++detailOpenGeneration;
    detailSubagentsGeneration += 1;
    subagentMessagesGeneration += 1;
    try {
      const [snapshot, checkpoints, detailApprovals, subagents] = await Promise.all([
        facade.getRun(candidate.id),
        facade.listCheckpoints(candidate.id),
        facade.listApprovals(candidate.id),
        facade.listSubagents(candidate.id),
      ]);
      if (requestGeneration !== detailOpenGeneration) return;
      detailSnapshot.value = snapshot;
      detailCheckpoints.value = checkpoints;
      detailApprovalBatch.value = detailApprovals;
      detailSubagents.value = subagents.items;
      selectedSubagentId.value = null;
      detailSubagentMessages.value = [];
      detailVisible.value = true;
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

  const saveCheckpoint = async (snapshot: AgentRunSnapshot | AgentRunView): Promise<void> => {
    if (!beginRuntimeMutation()) return;
    try {
      await facade.saveCheckpoint(snapshot as AgentRunSnapshot);
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
    snapshot: AgentRunSnapshot | AgentRunView,
    checkpoint: AgentCheckpointView,
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

  const deleteRun = async (snapshot: AgentRunSnapshot): Promise<void> => {
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

  const deleteThreadConversation = async (thread: AgentThreadView): Promise<void> => {
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

  const requestDeleteThread = (thread: AgentThreadView): void => {
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
      threadQuery.value = '';
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

  const syncTaskRailViewport = (): void => {
    const wide = window.innerWidth > 1040;
    if (wide === taskRailWideViewport) return;
    taskRailWideViewport = wide;
  };

  const syncThreadListMetrics = (): void => {
    const scroller = threadListScroller.value;
    if (!scroller) return;
    threadListScrollTop.value = scroller.scrollTop;
    threadListViewportHeight.value = scroller.clientHeight;
  };

  const maybeLoadMoreThreads = (): void => {
    const scroller = threadListScroller.value;
    if (!scroller || threadQuery.value || !threadNextCursor.value || threadListLoadingMore.value) return;
    const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const threshold = Math.max(72, threadRowHeight.value * 3);
    if (remaining <= threshold) void loadMoreThreads();
  };

  const onThreadListScroll = (event: Event): void => {
    const scroller = event.currentTarget;
    if (!(scroller instanceof HTMLElement)) return;
    threadListScrollTop.value = scroller.scrollTop;
    if (threadListViewportHeight.value !== scroller.clientHeight) {
      threadListViewportHeight.value = scroller.clientHeight;
    }
    maybeLoadMoreThreads();
  };

  const persistThreadListScale = (): void => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(THREAD_LIST_SCALE_STORAGE_KEY, String(threadListScale.value));
    } catch {
      // Preference persistence is best-effort; zoom should keep working without storage access.
    }
  };

  const onThreadListWheel = (event: WheelEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;

    const direction = event.deltaY < 0 ? 1 : -1;
    const nextScale = Math.min(
      THREAD_LIST_SCALE_MAX,
      Math.max(
        THREAD_LIST_SCALE_MIN,
        Math.round((threadListScale.value + direction * THREAD_LIST_SCALE_STEP) * 10) / 10,
      ),
    );
    if (nextScale === threadListScale.value) return;

    event.preventDefault();
    const scroller = threadListScroller.value;
    const previousRowHeight = threadRowHeight.value;
    const anchorRow = scroller ? scroller.scrollTop / previousRowHeight : 0;

    threadListScale.value = nextScale;
    persistThreadListScale();

    void nextTick(() => {
      if (scroller) scroller.scrollTop = anchorRow * threadRowHeight.value;
      syncThreadListMetrics();
      maybeLoadMoreThreads();
    });
  };

  const resetThreadListScroll = (): void => {
    threadListScrollTop.value = 0;
    void nextTick(() => {
      if (threadListScroller.value) threadListScroller.value.scrollTop = 0;
      syncThreadListMetrics();
    });
  };

  watch(threadQuery, resetThreadListScroll);

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

  onMounted(() => {
    window.addEventListener('resize', syncTaskRailViewport);
    window.addEventListener('focus', refreshConnectionsOnFocus);
    window.addEventListener('nexus:agent:thread-changed', onThreadChanged);
    window.addEventListener('nexus:agent:authorization-changed', onAuthorizationChanged);
    void nextTick(() => {
      syncThreadListMetrics();
      const scroller = threadListScroller.value;
      if (scroller && typeof ResizeObserver !== 'undefined') {
        threadListResizeObserver = new ResizeObserver(() => {
          syncThreadListMetrics();
          maybeLoadMoreThreads();
        });
        threadListResizeObserver.observe(scroller);
      }
      void load();
    });
  });
  onBeforeUnmount(() => {
    clearThreadDeleteArm();
    clearDeleteAllThreadsArm();
    threadListResizeObserver?.disconnect();
    threadListResizeObserver = null;
    window.removeEventListener('resize', syncTaskRailViewport);
    window.removeEventListener('focus', refreshConnectionsOnFocus);
    window.removeEventListener('nexus:agent:thread-changed', onThreadChanged);
    window.removeEventListener('nexus:agent:authorization-changed', onAuthorizationChanged);
    facade.dispose();
    streamingText.value = '';
  });
</script>

<template>
  <div class="agent-surface-layout relative grid h-full min-h-0" :class="{ 'has-task-rail': taskRailVisible }">
    <aside
      class="agent-thread-sidebar flex min-h-0 flex-col border-r border-border/45 bg-header/30 backdrop-blur-xs select-none"
      :class="{ 'is-open': threadSidebarVisible }"
    >
      <div class="flex h-10 shrink-0 items-center justify-between border-b border-border/45 px-3">
        <div class="flex min-w-0 items-center gap-2">
          <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70"></span>
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="text-xs font-semibold text-foreground leading-none">{{ $t('agent.operations.threads') }}</span>
            <span v-if="threads.length" class="text-[10px] font-medium leading-none text-text-secondary/60">
              {{ threadNextCursor ? `${threads.length}+` : threads.length }}
            </span>
            <span
              v-if="activeThreadCount > 0"
              class="flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[9px] font-medium leading-none text-success"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-success animate-pulse"></span>
              <span>{{ activeThreadCount }}</span>
            </span>
          </div>
        </div>

        <div class="flex items-center gap-0.5">
          <button
            v-if="threads.length"
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
            :class="
              deleteAllThreadsArmed
                ? 'bg-error/10 text-error'
                : 'text-text-secondary hover:bg-error/10 hover:text-error'
            "
            :aria-label="
              deleteAllThreadsArmed
                ? $t('agent.operations.confirmDeleteAllThreads')
                : $t('agent.operations.deleteAllThreads')
            "
            :title="
              activeThreadCount > 0
                ? $t('agent.operations.deleteAllThreadsActiveHint')
                : deleteAllThreadsArmed
                  ? $t('agent.operations.confirmDeleteAllThreads')
                  : $t('agent.operations.deleteAllThreads')
            "
            :disabled="busy || activeThreadCount > 0"
            @click="requestDeleteAllConversations"
          >
            <i class="fa-solid fa-trash-can text-[9px]" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-card/70 hover:text-foreground active:scale-95 disabled:opacity-50"
            :aria-label="$t('agent.operations.newThread')"
            :title="$t('agent.operations.newThread')"
            :disabled="busy"
            @click="beginThreadCreation"
          >
            <i class="fa-solid fa-plus text-[9px] text-primary" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <div class="shrink-0 border-b border-border/40 px-2.5 py-2">
        <div class="relative flex items-center">
          <i
            class="fa-solid fa-magnifying-glass pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary"
            aria-hidden="true"
          ></i>
          <input
            v-model="threadQuery"
            type="search"
            data-no-highlight
            class="h-7 w-full rounded-lg border border-transparent bg-background/55 pl-7.5 pr-7 text-[10.5px] text-foreground placeholder:text-text-secondary/40 outline-none transition-all hover:bg-card/65 focus:border-primary/20 focus:bg-card/80 focus:ring-2 focus:ring-primary/10"
            :placeholder="$t('agent.operations.searchThreads')"
          />
          <button
            v-if="threadQuery"
            type="button"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-foreground text-[11px]"
            @click="threadQuery = ''"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <div
        ref="threadListScroller"
        class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5 scrollbar-thin"
        :title="$t('agent.operations.threadZoomHint')"
        @scroll.passive="onThreadListScroll"
        @wheel="onThreadListWheel"
      >
        <div
          v-if="threadWindow.topSpacer > 0"
          :style="{ height: `${threadWindow.topSpacer}px` }"
          aria-hidden="true"
        ></div>
        <div
          v-for="(thread, threadOffset) in renderedThreads"
          :key="thread.id"
          class="group relative mb-0.5"
          :style="{ height: `${Math.max(30, threadRowHeight - 2)}px` }"
        >
          <button
            type="button"
            class="agent-thread-row relative flex h-full w-full items-center gap-2 rounded-lg px-2 py-1.5 pr-8 text-left transition-[height,background-color,color] duration-150"
            :style="{
              paddingTop: `${6 * threadListScale}px`,
              paddingBottom: `${6 * threadListScale}px`,
            }"
            :class="
              currentThread?.id === thread.id
                ? 'bg-primary/[0.055] text-foreground font-medium pl-2.5'
                : 'text-text-secondary hover:bg-card/45 hover:text-foreground'
            "
            :aria-current="currentThread?.id === thread.id ? 'true' : undefined"
            :aria-setsize="visibleThreads.length"
            :aria-posinset="threadWindow.start + threadOffset + 1"
            :disabled="busy"
            @click="selectThread(thread)"
          >
            <!-- 激活状态专属左侧品牌指示条 -->
            <span
              v-if="currentThread?.id === thread.id"
              class="absolute left-0.5 top-2 bottom-2 w-0.5 rounded-full bg-primary"
            ></span>

            <!-- 轻量会话状态点 -->
            <span class="relative mt-px flex h-4 w-3 shrink-0 items-center justify-center" aria-hidden="true">
              <span
                class="relative z-10 h-1.5 w-1.5 rounded-full transition-colors"
                :class="
                  threadStatus(thread.id) && nonTerminal.has(threadStatus(thread.id)!)
                    ? threadStatus(thread.id) === 'awaiting_approval' || threadStatus(thread.id) === 'awaiting_budget'
                      ? 'bg-warning'
                      : 'bg-success'
                    : currentThread?.id === thread.id
                      ? 'bg-primary'
                      : 'bg-text-secondary/25 group-hover:bg-text-secondary/45'
                "
              ></span>
              <span
                v-if="threadStatus(thread.id) && nonTerminal.has(threadStatus(thread.id)!)"
                class="absolute h-2.5 w-2.5 animate-ping rounded-full opacity-35"
                :class="
                  threadStatus(thread.id) === 'awaiting_approval' || threadStatus(thread.id) === 'awaiting_budget'
                    ? 'bg-warning'
                    : 'bg-success'
                "
              ></span>
            </span>

            <!-- 标题与状态行 -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-1">
                <span
                  class="truncate text-[10.75px] leading-[1.35] tracking-[-0.012em]"
                  :style="{ fontSize: `${10.75 * threadListScale}px` }"
                  :class="
                    currentThread?.id === thread.id
                      ? 'font-semibold text-foreground'
                      : 'text-foreground/90 group-hover:text-foreground'
                  "
                  :title="thread.title || $t('agent.operations.untitledThread')"
                >
                  {{ thread.title || $t('agent.operations.untitledThread') }}
                </span>
              </div>
              <div
                class="mt-0.5 flex items-center justify-between gap-1.5 text-[9px] text-text-secondary/50"
                :style="{ marginTop: `${2 * threadListScale}px`, fontSize: `${9 * threadListScale}px` }"
              >
                <span
                  v-if="threadStatus(thread.id) && nonTerminal.has(threadStatus(thread.id)!)"
                  class="inline-flex items-center rounded-sm px-1 py-0.2 font-medium"
                  :class="
                    threadStatus(thread.id) === 'awaiting_approval' || threadStatus(thread.id) === 'awaiting_budget'
                      ? 'bg-warning/15 text-warning'
                      : 'bg-success/15 text-success'
                  "
                >
                  {{ $t(`agent.tasks.runStatus.${threadStatus(thread.id)}`) }}
                </span>
                <span
                  v-else
                  class="truncate font-mono text-[9px] text-text-secondary/45"
                  :style="{ fontSize: `${9 * threadListScale}px` }"
                >
                  #{{ thread.id.slice(-6) }}
                </span>
                <span
                  class="shrink-0 text-[9px] tabular-nums text-text-secondary/50"
                  :style="{ fontSize: `${9 * threadListScale}px` }"
                >
                  {{ formatThreadUpdatedAt(thread.updatedAt) }}
                </span>
              </div>
            </div>
          </button>
          <button
            type="button"
            class="absolute right-1 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md opacity-0 transition-[opacity,background-color,color] group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-25"
            :class="[
              threadDeleteArmedId === thread.id
                ? 'bg-error/10 text-error opacity-100'
                : 'text-text-secondary/70 hover:bg-error/10 hover:text-error',
              currentThread?.id === thread.id ? 'opacity-100' : '',
            ]"
            :aria-label="
              threadDeleteArmedId === thread.id
                ? $t('agent.operations.confirmDeleteThread')
                : $t('agent.operations.deleteThread')
            "
            :title="
              threadStatus(thread.id) && nonTerminal.has(threadStatus(thread.id)!)
                ? $t('agent.operations.deleteThreadActiveHint')
                : threadDeleteArmedId === thread.id
                  ? $t('agent.operations.confirmDeleteThread')
                  : $t('agent.operations.deleteThread')
            "
            :disabled="busy || Boolean(threadStatus(thread.id) && nonTerminal.has(threadStatus(thread.id)!))"
            @click.stop="requestDeleteThread(thread)"
          >
            <i class="fa-solid fa-trash-can text-[9px]" aria-hidden="true"></i>
          </button>
        </div>
        <div
          v-if="threadWindow.bottomSpacer > 0"
          :style="{ height: `${threadWindow.bottomSpacer}px` }"
          aria-hidden="true"
        ></div>

        <div
          v-if="threadListLoadingMore && !threadQuery"
          class="mx-auto mt-1.5 flex h-7 items-center gap-1.5 px-2.5 text-[10px] text-text-secondary/70"
          aria-live="polite"
        >
          <i class="fa-solid fa-spinner fa-spin text-[8px]" aria-hidden="true"></i>
          <span>{{ $t('agent.operations.loading') }}</span>
        </div>

        <!-- 空状态 -->
        <div
          v-if="visibleThreads.length === 0"
          class="flex flex-col items-center justify-center rounded-xl bg-background/50 px-3 py-8 text-center"
        >
          <div class="flex h-8 w-8 items-center justify-center rounded-full bg-header text-text-secondary/60">
            <i class="fa-regular fa-comment-dots text-xs" aria-hidden="true"></i>
          </div>
          <p class="mt-2 text-xs text-text-secondary">{{ $t('agent.operations.noThreadsFound') }}</p>
        </div>
      </div>
    </aside>

    <button
      type="button"
      class="agent-thread-backdrop absolute inset-0 z-20 hidden bg-background/55 backdrop-blur-[1px]"
      :class="{ 'is-open': threadSidebarVisible }"
      :aria-label="$t('agent.operations.closeThreads')"
      @click="threadSidebarVisible = false"
    ></button>

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
                class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none"
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
              class="flex h-7.5 w-7.5 items-center justify-center rounded-lg border transition-all disabled:cursor-not-allowed disabled:opacity-35"
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
                class="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[8px] font-bold leading-none text-white shadow-xs"
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
                    <div class="mt-0.5 text-[10px] leading-4 text-text-secondary/75">
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
                  class="agent-config-summary flex h-[26px] items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2 text-[11px] font-medium leading-[1.25] text-text-secondary select-none"
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
                    <div class="max-h-64 space-y-1 overflow-y-auto">
                      <button
                        v-for="option in modelOptions"
                        :key="option.key"
                        type="button"
                        class="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors"
                        :class="
                          option.key === selectedModelKey
                            ? 'border border-border/80 bg-card font-medium text-foreground shadow-xs'
                            : 'border border-transparent text-text-secondary hover:bg-card/70'
                        "
                        :disabled="busy"
                        @click="
                          setModelSelection(option.key);
                          close(true);
                        "
                      >
                        <span
                          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border"
                          :class="
                            option.key === selectedModelKey
                              ? 'border-border/60 bg-header text-foreground'
                              : 'border-transparent bg-header/60 text-text-secondary'
                          "
                        >
                          <i class="fa-solid fa-microchip text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-xs font-medium text-foreground">{{ option.model.id }}</span>
                          <span class="block truncate text-[10px] text-text-secondary">
                            {{ option.provider.displayName }}
                          </span>
                        </span>
                        <i
                          v-if="option.key === selectedModelKey"
                          class="fa-solid fa-check text-[10px] text-foreground"
                          aria-hidden="true"
                        ></i>
                      </button>
                    </div>
                  </template>
                </AgentConfigPopover>
                <span v-else class="min-w-32 flex-1 px-2 text-xs text-text-secondary">
                  {{ $t('agent.operations.providerMissing') }}
                </span>

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
                      :class="approvalModeValue === 'full_access' ? 'text-success' : 'text-warning'"
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
                      class="agent-config-affordance text-[7px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel="{ close }">
                    <div class="mb-2 flex items-center justify-between gap-2 px-1">
                      <div>
                        <div class="text-xs font-semibold">{{ $t('agent.operations.approvalMode') }}</div>
                        <div class="mt-1 text-[10px] leading-4 text-text-secondary">
                          {{ $t('agent.operations.approvalModeHint') }}
                        </div>
                      </div>
                      <span
                        v-if="modelSelectionLocked"
                        class="rounded-full bg-header px-2 py-0.5 text-[9px] text-text-secondary"
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
                            ? 'border-warning/25 bg-warning/[0.06] text-foreground'
                            : 'border-transparent text-text-secondary hover:bg-card/70'
                        "
                        :disabled="modelSelectionLocked || busy"
                        @click="
                          setApprovalMode('ask');
                          close(true);
                        "
                      >
                        <span
                          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning"
                        >
                          <i class="fa-solid fa-hand text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block text-xs font-semibold text-foreground">{{
                            $t('agent.operations.approvalAsk')
                          }}</span>
                          <span class="mt-0.5 block text-[10px] leading-4 text-text-secondary">{{
                            $t('agent.operations.approvalAskDesc')
                          }}</span>
                        </span>
                        <i
                          v-if="approvalModeValue === 'ask'"
                          class="fa-solid fa-check mt-1.5 text-[9px] text-warning"
                          aria-hidden="true"
                        ></i>
                      </button>
                      <button
                        type="button"
                        class="flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors disabled:cursor-default"
                        :class="
                          approvalModeValue === 'full_access'
                            ? 'border-success/25 bg-success/[0.06] text-foreground'
                            : 'border-transparent text-text-secondary hover:bg-card/70'
                        "
                        :disabled="modelSelectionLocked || busy"
                        @click="
                          setApprovalMode('full_access');
                          close(true);
                        "
                      >
                        <span
                          class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"
                        >
                          <i class="fa-solid fa-bolt text-[9px]" aria-hidden="true"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block text-xs font-semibold text-foreground">{{
                            $t('agent.operations.approvalFullAccess')
                          }}</span>
                          <span class="mt-0.5 block text-[10px] leading-4 text-text-secondary">{{
                            $t('agent.operations.approvalFullAccessDesc')
                          }}</span>
                        </span>
                        <i
                          v-if="approvalModeValue === 'full_access'"
                          class="fa-solid fa-check mt-1.5 text-[9px] text-success"
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
                      class="agent-config-affordance text-[7px] text-text-secondary"
                      aria-hidden="true"
                    ></i>
                  </template>
                  <template #panel="{ close }">
                    <div class="mb-2 flex items-center justify-between gap-2 px-1">
                      <span class="text-xs font-semibold">{{ $t('agent.operations.environment') }}</span>
                      <span
                        v-if="modelSelectionLocked"
                        class="rounded-full bg-header px-2 py-0.5 text-[9px] text-text-secondary"
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
                          <span class="block truncate text-[10px] text-text-secondary">{{
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
                          <span class="block truncate font-mono text-[10px] text-text-secondary">{{ recipe.id }}</span>
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
                      class="agent-ssh-count inline-flex min-w-[0.6rem] items-center justify-center text-[9px] font-semibold leading-none"
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
                        <div class="mt-1 text-[10px] leading-snug text-text-secondary/70">
                          {{ $t('agent.operations.targetsHint') }}
                        </div>
                      </div>
                      <span
                        v-if="modelSelectionLocked"
                        class="shrink-0 rounded-md bg-header/70 px-1.5 py-1 text-[9px] leading-none text-text-secondary"
                      >
                        <i class="fa-solid fa-lock mr-1 text-[7px]" aria-hidden="true"></i
                        >{{ $t('agent.operations.frozen') }}
                      </span>
                    </div>

                    <div
                      v-if="connections.length > 0"
                      class="mb-1.5 flex items-center justify-between gap-2 rounded-lg bg-header/30 px-2 py-1.5"
                    >
                      <div class="flex min-w-0 items-center gap-1.5 text-[9.5px] text-text-secondary/70">
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
                        class="grid h-6 w-[54px] shrink-0 grid-cols-3 items-center overflow-hidden rounded-md border border-border/65 bg-background/55 p-0.5 transition-colors disabled:cursor-default disabled:opacity-35"
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
                          class="flex h-5 items-center justify-center rounded-[4px] text-[8px] transition-all"
                          :class="
                            connectionSelectionState === 'off' ? 'bg-error/10 text-error/85' : 'text-text-secondary/45'
                          "
                          aria-hidden="true"
                        >
                          <i class="fa-solid fa-xmark"></i>
                        </span>
                        <span
                          class="flex h-5 items-center justify-center rounded-[4px] text-[8px] transition-all"
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
                          class="flex h-5 items-center justify-center rounded-[4px] text-[8px] transition-all"
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
                          <span class="mt-1 block truncate font-mono text-[9.5px] leading-none text-text-secondary/60"
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

                <!-- 思考强度：GPT 官方饱满胶囊滑块卡片 -->
                <AgentConfigPopover
                  v-if="reasoningCapabilityAvailable || (modelSelectionLocked && reasoningValue)"
                  :ariaLabel="$t('agent.ui.reasoning')"
                  :title="`${$t('agent.ui.reasoning')}: ${reasoningDisplayLabel}`"
                  panel-class="w-56"
                >
                  <template #trigger>
                    <i class="fa-solid fa-bolt text-[9px] text-indigo-500" aria-hidden="true"></i>
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
                                ? 'bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 shadow-[0_0_8px_rgba(168,85,247,0.35)]'
                                : 'bg-gradient-to-r from-blue-500 to-indigo-500',
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
                            class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-[18px] w-[18px] rounded-full bg-white text-gray-800 shadow-sm flex items-center justify-center cursor-grab active:cursor-grabbing z-20 ring-1 ring-black/10"
                            :class="
                              isDraggingReasoning
                                ? 'scale-110 shadow-md cursor-grabbing'
                                : 'transition-[left,transform] duration-150 ease-out'
                            "
                            :style="{ left: `${thumbLeftPercent}%` }"
                          >
                            <span
                              class="h-1.5 w-1.5 rounded-full transition-colors"
                              :class="isDraggingReasoning ? 'bg-indigo-600' : 'bg-indigo-600/50'"
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
  .agent-config-summary {
    font-size: 11px;
    line-height: 1;
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
    .agent-config-summary {
      font-size: 10.5px;
    }

    .agent-config-affordance {
      display: none;
    }

    :deep(.agent-config-summary) {
      height: 25px;
      padding-inline: 6px;
      gap: 4px;
      font-size: 10.5px;
    }

    .agent-config-verbose {
      max-width: 5.5rem;
    }

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

  @container agent-conversation-pane (max-width: 700px) {
    .agent-run-config {
      min-width: 0;
      gap: 0.2rem;
    }

    .agent-config-affordance {
      display: none;
    }

    :deep(.agent-config-summary) {
      height: 25px;
      padding-inline: 6px;
      gap: 4px;
      font-size: 10.5px;
      line-height: 1.25;
    }

    .agent-config-verbose,
    :deep(.agent-config-verbose) {
      max-width: 5.5rem;
    }
  }

  @container agent-conversation-pane (max-width: 560px) {
    .agent-run-config {
      overflow: hidden;
    }

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
      min-width: 25px;
      height: 25px;
      gap: 3px;
      padding-inline: 6px;
      font-size: 10px;
      line-height: 1.25;
    }

    .agent-config-reasoning {
      width: auto;
      min-width: 0.75rem;
      font-size: 10px;
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

    .agent-thread-sidebar {
      position: absolute;
      inset: 0 auto 0 0;
      z-index: 30;
      width: min(280px, calc(100% - 48px));
      transform: translateX(-102%);
      visibility: hidden;
      box-shadow: 12px 0 32px rgb(0 0 0 / 0.18);
      transition: transform 160ms ease;
    }

    .agent-thread-sidebar.is-open {
      visibility: visible;
      transform: translateX(0);
    }

    .agent-thread-backdrop.is-open {
      display: block;
    }

    .agent-thread-toggle {
      display: flex;
    }

    .agent-config-label {
      display: none;
    }

    .agent-run-config {
      flex-wrap: nowrap;
      align-content: center;
      gap: 0.2rem;
    }

    .agent-config-verbose,
    .agent-config-affordance {
      display: none;
    }

    :deep(.agent-config-verbose) {
      display: none;
    }

    .agent-config-compact {
      display: inline;
    }

    :deep(.agent-config-compact) {
      display: inline;
    }

    .agent-config-reasoning {
      width: auto;
      min-width: 0.75rem;
      font-size: 10px;
      line-height: 1.25;
    }

    :deep(.agent-config-summary) {
      min-width: 25px;
      height: 25px;
      gap: 3px;
      border-radius: 6px;
      padding-inline: 6px;
      font-size: 10px;
      line-height: 1.25;
    }

    .agent-detail-label {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-thread-sidebar {
      transition: none;
    }
  }

  .agent-thread-sidebar ::-webkit-scrollbar {
    width: 4px;
  }
  .agent-thread-sidebar ::-webkit-scrollbar-track {
    background: transparent;
  }
  .agent-thread-sidebar ::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 9999px;
  }
  .agent-thread-sidebar ::-webkit-scrollbar-thumb:hover {
    background: var(--text-color-secondary);
  }
</style>
