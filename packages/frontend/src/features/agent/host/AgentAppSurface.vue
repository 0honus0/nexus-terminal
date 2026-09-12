<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { connectionService, type Connection } from '@/features/connections/public';
  import AgentConversation from '../ai/AgentConversation.vue';
  import { agentApi, formatAgentApiError } from '../api/agent-api';
  import type {
    AgentApprovalBatch,
    AgentApprovalView,
    AgentCheckpointView,
    AgentArtifactRef,
    AgentDefinitionView,
    AgentHardLimits,
    AgentLedgerEntry,
    AgentProviderView,
    AgentRunSnapshot,
    AgentRunView,
    AgentSubagentMessage,
    AgentSubagentView,
    AgentThreadView,
  } from '../api/agent-api';
  import { agentSurfaceSession } from './surface-session';
  import { createAgentRunFacade } from '../runtime/run-facade';
  import { createRuntimeOperationState } from '../runtime/runtime-operation-state';
  import TaskDetailDrawer from '../runtime/TaskDetailDrawer.vue';
  import TaskRail from '../runtime/TaskRail.vue';

  const props = defineProps<{ appId: string }>();
  const { t } = useI18n();
  const facade = createAgentRunFacade(props.appId);
  facade.start();
  const runtimeOperation = createRuntimeOperationState();
  const threads = ref<AgentThreadView[]>([]);
  const currentThread = ref<AgentThreadView | null>(null);
  const entries = ref<AgentLedgerEntry[]>([]);
  const nextCursor = ref<string | null>(null);
  const run = ref<AgentRunView | null>(null);
  const threadRuns = ref<AgentRunView[]>([]);
  const definitions = ref<AgentDefinitionView[]>([]);
  const providers = ref<AgentProviderView[]>([]);
  const connections = ref<Connection[]>([]);
  const selectedConnectionIds = ref<number[]>([]);
  const attachments = ref<AgentArtifactRef[]>([]);
  const approvalBatch = ref<AgentApprovalBatch | null>(null);
  const approvals = computed(() => approvalBatch.value?.items ?? []);
  const pendingApprovals = computed(() => approvals.value.filter((approval) => approval.status === 'requested'));
  const hardLimits = ref<AgentHardLimits | null>(null);
  const backgroundRuns = ref<AgentRunView[]>([]);
  const detailSnapshot = ref<AgentRunSnapshot | null>(null);
  const detailCheckpoints = ref<AgentCheckpointView[]>([]);
  const detailApprovalBatch = ref<AgentApprovalBatch | null>(null);
  const detailSubagents = ref<AgentSubagentView[]>([]);
  const selectedSubagentId = ref<string | null>(null);
  const detailSubagentMessages = ref<AgentSubagentMessage[]>([]);
  const detailVisible = ref(false);
  const selectedModelKey = ref('');
  const newThreadEditorVisible = ref(false);
  const newThreadTitle = ref('');
  const streamingText = ref('');
  const busy = ref(false);
  const loading = ref(true);
  const error = ref('');
  const draft = ref(agentSurfaceSession.state(props.appId).draft);
  let threadSelectionGeneration = 0;
  let ledgerGeneration = 0;
  let approvalsGeneration = 0;
  let backgroundGeneration = 0;
  let detailSubagentsGeneration = 0;
  let detailOpenGeneration = 0;
  let subagentMessagesGeneration = 0;

  const nonTerminal = new Set(['created', 'running', 'awaiting_approval', 'awaiting_budget', 'cancelling']);
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
  const mutationLocked = computed(
    () => busy.value || runtimeOperation.mutationBlocked.value || run.value?.needsReconciliation === true,
  );
  const canSend = computed(
    () => Boolean(definitions.value[0] && providerSelection.value && currentThread.value) && !mutationLocked.value,
  );

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

  const refreshRun = async (runId: string, minimumEventCursor = 0): Promise<AgentRunSnapshot | null> => {
    try {
      const snapshot = await facade.getRun(runId, minimumEventCursor);
      if (currentThread.value?.id !== snapshot.threadId || (run.value !== null && run.value.id !== runId)) return null;
      run.value = snapshot;
      rememberThreadRun(snapshot);
      if (snapshot.needsReconciliation) {
        runtimeOperation.markReconciling('RECONCILIATION_REQUIRED', t('agent.operations.reconciliationRequired'));
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

  const stopRunStream = (): void => {
    facade.selectRun(null);
    streamingText.value = '';
  };

  const startRunStream = (initial: AgentRunView): void => {
    streamingText.value = '';
    facade.selectRun(initial, {
      onEvent: async (event, signal) => {
        if (signal.aborted) return;
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
        error.value = explain(cause);
      },
    });
  };

  const selectThread = async (thread: AgentThreadView): Promise<void> => {
    if (currentThread.value?.id === thread.id) return;
    const selectionGeneration = ++threadSelectionGeneration;
    stopRunStream();
    currentThread.value = thread;
    agentSurfaceSession.setThread(props.appId, thread.id);
    await refreshLedger();
    if (selectionGeneration !== threadSelectionGeneration || currentThread.value?.id !== thread.id) return;
    const runs = await facade.listRuns(thread.id);
    if (selectionGeneration !== threadSelectionGeneration || currentThread.value?.id !== thread.id) return;
    threadRuns.value = runs.items;
    const active = runs.items.find((candidate) => nonTerminal.has(candidate.status)) ?? runs.items[0] ?? null;
    run.value = active;
    await refreshApprovals(active?.id);
    if (selectionGeneration !== threadSelectionGeneration || currentThread.value?.id !== thread.id) return;
    if (active && nonTerminal.has(active.status)) startRunStream(active);
    await refreshBackgroundRuns();
  };

  const createThread = async (title?: string): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      const normalizedTitle = title?.trim();
      const thread = await facade.createThread(normalizedTitle || undefined);
      threads.value = [thread, ...threads.value.filter((item) => item.id !== thread.id)];
      newThreadEditorVisible.value = false;
      newThreadTitle.value = '';
      await selectThread(thread);
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const beginThreadCreation = (): void => {
    newThreadTitle.value = '';
    newThreadEditorVisible.value = true;
  };

  const cancelThreadCreation = (): void => {
    newThreadTitle.value = '';
    newThreadEditorVisible.value = false;
  };

  const load = async (): Promise<void> => {
    loading.value = true;
    error.value = '';
    try {
      const [threadPage, nextDefinitions, nextProviders, settings, nextConnections] = await Promise.all([
        facade.listThreads(),
        facade.definitions(),
        facade.providers(),
        facade.settings(),
        connectionService.list(),
      ]);
      threads.value = threadPage.items;
      definitions.value = nextDefinitions;
      providers.value = nextProviders;
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
      hardLimits.value = settings.hardLimits;
      connections.value = nextConnections.filter((connection) => connection.type === 'SSH');
      const restored = agentSurfaceSession.restoreThread(props.appId);
      const selected = threads.value.find((thread) => thread.id === restored) ?? threads.value[0];
      if (selected) await selectThread(selected);
      else await createThread();
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      loading.value = false;
    }
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

  const send = async (text: string, selectedArtifacts: AgentArtifactRef[]): Promise<void> => {
    if (!currentThread.value || !beginRuntimeMutation()) return;
    try {
      const active = run.value;
      if (active && nonTerminal.has(active.status)) {
        const artifactRefs = await resolveArtifactRefs(selectedArtifacts, active);
        await facade.appendInput(active, text, artifactRefs);
        draft.value = '';
        attachments.value = [];
        agentSurfaceSession.setDraft(props.appId, '');
        await refreshLedger();
        const next = await refreshRun(active.id);
        await Promise.all([refreshApprovals(active.id), refreshBackgroundRuns()]);
        if (next) startRunStream(next);
        runtimeOperation.succeed();
        return;
      }
      const selection = providerSelection.value;
      const definition = definitions.value[0];
      if (!selection || !definition) throw new Error('AGENT_PROVIDER_REQUIRED');
      const artifactRefs = await resolveArtifactRefs(selectedArtifacts);
      const created = await facade.createRun({
        threadId: currentThread.value.id,
        text,
        artifactRefs,
        agentDefinitionId: definition.id,
        model: {
          providerId: selection.provider.id,
          modelId: selection.model.id,
          configurationVersion: selection.provider.version,
        },
        connectionIds: selectedConnectionIds.value,
      });
      run.value = created;
      rememberThreadRun(created);
      draft.value = '';
      attachments.value = [];
      agentSurfaceSession.setDraft(props.appId, '');
      await refreshLedger();
      await Promise.all([refreshApprovals(created.id), refreshBackgroundRuns()]);
      startRunStream(created);
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

  const resolveApproval = async (approval: AgentApprovalView, decision: 'approved' | 'denied'): Promise<void> => {
    if (approval.status !== 'requested' || !beginRuntimeMutation()) return;
    try {
      await facade.resolveApproval(approval, decision);
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

  const saveCheckpoint = async (snapshot: AgentRunSnapshot): Promise<void> => {
    if (!beginRuntimeMutation()) return;
    try {
      await facade.saveCheckpoint(snapshot);
      detailCheckpoints.value = await facade.listCheckpoints(snapshot.id);
      runtimeOperation.succeed();
    } catch (cause) {
      await recoverRuntimeFailure(cause, snapshot.id);
    } finally {
      finishRuntimeMutation();
    }
  };

  const resumeCheckpoint = async (snapshot: AgentRunSnapshot, checkpoint: AgentCheckpointView): Promise<void> => {
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

  onMounted(load);
  onBeforeUnmount(() => {
    facade.dispose();
    streamingText.value = '';
  });
</script>

<template>
  <div class="relative grid h-full min-h-0 grid-cols-[236px_minmax(0,1fr)] xl:grid-cols-[236px_minmax(0,1fr)_296px]">
    <aside class="flex min-h-0 flex-col border-r border-border/80 bg-card/60">
      <div class="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-3">
        <div class="flex items-center gap-2">
          <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-[10px] text-primary">
            <i class="fa-regular fa-comments" aria-hidden="true"></i>
          </div>
          <div>
            <strong class="block text-xs leading-none">{{ $t('agent.operations.threads') }}</strong>
            <span class="mt-1 block text-[9px] text-text-secondary">{{ threads.length }}</span>
          </div>
        </div>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-[10px] text-text-secondary hover:bg-header hover:text-foreground disabled:opacity-50"
          :aria-label="$t('agent.operations.newThread')"
          :title="$t('agent.operations.newThread')"
          :disabled="busy"
          @click="beginThreadCreation"
        >
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
        </button>
      </div>

      <form
        v-if="newThreadEditorVisible"
        class="shrink-0 border-b border-border/70 bg-background/60 p-2"
        @submit.prevent="createThread(newThreadTitle)"
      >
        <label class="sr-only" for="agent-new-thread-title">{{ $t('agent.operations.threadTitle') }}</label>
        <input
          id="agent-new-thread-title"
          v-model="newThreadTitle"
          autofocus
          maxlength="200"
          class="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-[11px] outline-none focus:border-primary/60"
          :placeholder="$t('agent.operations.threadTitlePlaceholder')"
          @keydown.esc.prevent="cancelThreadCreation"
        />
        <div class="mt-2 flex justify-end gap-1.5">
          <button
            type="button"
            class="rounded-lg px-2.5 py-1.5 text-[9px] text-text-secondary hover:bg-header"
            :disabled="busy"
            @click="cancelThreadCreation"
          >
            {{ $t('common.cancel') }}
          </button>
          <button
            type="submit"
            class="rounded-lg bg-primary px-2.5 py-1.5 text-[9px] font-semibold text-white disabled:opacity-40"
            :disabled="busy || !newThreadTitle.trim()"
          >
            {{ $t('agent.operations.createThread') }}
          </button>
        </div>
      </form>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <button
          v-for="thread in threads"
          :key="thread.id"
          type="button"
          class="group mb-1 flex w-full items-center gap-2 rounded-xl border px-2 py-2.5 text-left transition-colors"
          :class="
            currentThread?.id === thread.id
              ? 'border-primary/20 bg-primary/10 text-foreground'
              : 'border-transparent text-text-secondary hover:border-border hover:bg-background hover:text-foreground'
          "
          @click="selectThread(thread)"
        >
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold"
            :class="currentThread?.id === thread.id ? 'bg-primary text-white' : 'bg-header text-text-secondary'"
          >
            {{ (thread.title || $t('agent.operations.untitledThread')).slice(0, 1).toUpperCase() }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[11px] font-medium">{{
              thread.title || $t('agent.operations.untitledThread')
            }}</span>
            <span class="mt-0.5 block truncate text-[8px] opacity-70">{{ thread.id }}</span>
          </span>
          <i
            v-if="currentThread?.id === thread.id"
            class="fa-solid fa-chevron-right text-[8px] text-primary"
            aria-hidden="true"
          ></i>
        </button>
      </div>

      <div class="shrink-0 border-t border-border/70 p-3">
        <div class="flex items-center gap-1.5 text-[10px] font-medium">
          <i class="fa-solid fa-server text-[9px] text-text-secondary" aria-hidden="true"></i>
          {{ $t('agent.operations.targets') }}
          <span class="ml-auto rounded-full bg-header px-1.5 py-0.5 text-[8px] text-text-secondary">
            {{ selectedConnectionIds.length }}/{{ connections.length }}
          </span>
        </div>
        <p class="mt-1 text-[9px] leading-4 text-text-secondary">{{ $t('agent.operations.targetsHint') }}</p>
        <div class="mt-2 max-h-36 space-y-1 overflow-y-auto">
          <label
            v-for="connection in connections"
            :key="connection.id"
            class="flex cursor-pointer items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-[10px] hover:border-border hover:bg-background"
          >
            <input
              v-model="selectedConnectionIds"
              type="checkbox"
              class="mt-0.5"
              :value="connection.id"
              :disabled="Boolean(run && nonTerminal.has(run.status))"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{ connection.name || connection.host }}</span>
              <span class="mt-0.5 block truncate text-[8px] text-text-secondary"
                >{{ connection.host }}:{{ connection.port }}</span
              >
            </span>
          </label>
          <p v-if="connections.length === 0" class="rounded-lg bg-background px-2 py-2 text-[9px] text-text-secondary">
            {{ $t('agent.operations.noTargets') }}
          </p>
        </div>
      </div>
    </aside>

    <main class="flex min-h-0 min-w-0 flex-col bg-background">
      <header class="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-card/30 px-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <strong class="truncate text-[11px]">{{
              currentThread?.title || $t('agent.operations.untitledThread')
            }}</strong>
            <span
              v-if="run"
              class="shrink-0 rounded-full px-2 py-0.5 text-[8px] font-medium"
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
          <div class="mt-1 flex items-center gap-2 text-[8px] text-text-secondary">
            <select
              v-if="modelOptions.length"
              :value="selectedModelKey"
              class="min-w-0 max-w-60 truncate rounded-md border border-transparent bg-transparent py-0 text-[8px] text-text-secondary outline-none hover:border-border focus:border-primary/50 disabled:opacity-60"
              :aria-label="$t('agent.operations.runModel')"
              :title="
                modelSelectionLocked ? $t('agent.operations.runModelLocked') : $t('agent.operations.runModelHint')
              "
              :disabled="modelSelectionLocked || busy"
              @change="setModelSelection(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="option in modelOptions" :key="option.key" :value="option.key">
                {{ option.provider.displayName }} · {{ option.model.id }}
              </option>
            </select>
            <span v-else>{{ $t('agent.operations.providerMissing') }}</span>
            <span v-if="selectedConnectionIds.length"
              >· {{ $t('agent.operations.targetCount', { count: selectedConnectionIds.length }) }}</span
            >
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <select
            v-if="threadRuns.length > 1 && run"
            :value="run.id"
            class="hidden h-7 max-w-36 rounded-lg border border-border bg-card px-2 text-[9px] text-text-secondary outline-none hover:bg-header md:block"
            :aria-label="$t('agent.tasks.history')"
            @change="openRunFromHistory(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="item in threadRuns" :key="item.id" :value="item.id">
              {{ $t(`agent.tasks.runStatus.${item.status}`) }} · {{ item.definition.model.modelId }}
            </option>
          </select>
          <button
            v-if="run && pendingApprovals.length"
            type="button"
            class="flex h-7 items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 text-[9px] font-semibold text-warning hover:bg-warning/15"
            :aria-label="$t('agent.approvals.openPending', { count: pendingApprovals.length })"
            @click="openRunDetail(run)"
          >
            <i class="fa-solid fa-shield-halved text-[8px]" aria-hidden="true"></i>
            {{ pendingApprovals.length }}
          </button>
          <button
            v-if="run"
            type="button"
            class="flex h-7 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[9px] font-medium text-text-secondary hover:bg-header hover:text-foreground"
            @click="openRunDetail(run)"
          >
            <i class="fa-solid fa-bars-progress text-[8px]" aria-hidden="true"></i>
            {{ $t('agent.tasks.openDetail') }}
          </button>
          <span
            v-if="attachments.length"
            class="hidden rounded-full bg-primary/10 px-2 py-1 text-[8px] font-medium text-primary sm:inline"
          >
            <i class="fa-solid fa-paperclip mr-1" aria-hidden="true"></i>{{ attachments.length }}
          </span>
        </div>
      </header>

      <div class="relative min-h-0 flex-1">
        <div v-if="loading" class="flex h-full items-center justify-center">
          <div class="flex flex-col items-center gap-3 text-text-secondary">
            <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
            </div>
            <span class="text-[10px]">{{ $t('agent.operations.loading') }}</span>
          </div>
        </div>
        <div
          v-else-if="error && entries.length === 0"
          class="flex h-full items-center justify-center p-6 text-center text-sm text-error"
        >
          <div class="max-w-sm rounded-xl border border-error/30 bg-error/10 px-4 py-3">{{ error }}</div>
        </div>
        <div v-else class="relative h-full min-h-0">
          <div
            v-if="error"
            class="absolute left-4 right-4 top-3 z-10 rounded-xl border border-error/30 bg-background/95 px-3 py-2 text-[10px] text-error shadow-lg"
          >
            <i class="fa-solid fa-circle-exclamation mr-1.5" aria-hidden="true"></i>{{ error }}
          </div>
          <div
            v-if="run?.needsReconciliation || runtimeOperation.phase.value === 'reconciling'"
            class="absolute left-4 right-4 top-14 z-10 rounded-xl border border-warning/40 bg-background/95 px-3 py-2 text-[10px] text-warning shadow-lg"
          >
            <i class="fa-solid fa-triangle-exclamation mr-1.5" aria-hidden="true"></i>
            {{ $t('agent.operations.reconciliationRequired') }}
          </div>
          <AgentConversation
            :app-id="appId"
            :entries="entries"
            :next-cursor="nextCursor"
            :run="run"
            :streaming-text="streamingText"
            :draft="draft"
            :busy="mutationLocked"
            :can-send="canSend"
            :attachments="attachments"
            @load-older="loadOlder"
            @send="send"
            @cancel="cancel"
            @update-draft="updateDraft"
            @update-attachments="attachments = $event"
          />
        </div>
      </div>
    </main>

    <div class="hidden min-h-0 xl:block">
      <TaskRail
        :current="run"
        :background-runs="backgroundRuns"
        :thread-runs="threadRuns"
        :hard-limits="hardLimits"
        :approvals="approvals"
        :approval-clock="approvalBatch?.clock ?? null"
        :busy="mutationLocked"
        @increase-budget="increaseBudget"
        @resolve-approval="resolveApproval"
        @open-run="openRunDetail"
      />
    </div>

    <TaskDetailDrawer
      :snapshot="detailSnapshot"
      :checkpoints="detailCheckpoints"
      :approvals="detailApprovalBatch?.items ?? []"
      :approval-clock="detailApprovalBatch?.clock ?? null"
      :subagents="detailSubagents"
      :selected-subagent-id="selectedSubagentId"
      :subagent-messages="detailSubagentMessages"
      :visible="detailVisible"
      :busy="mutationLocked"
      @close="closeRunDetail"
      @save-checkpoint="saveCheckpoint"
      @resume-checkpoint="resumeCheckpoint"
      @select-subagent="selectSubagent"
      @cancel-subagent="cancelSubagent"
      @resolve-approval="resolveApproval"
      @delete-run="deleteRun"
    />
  </div>
</template>
