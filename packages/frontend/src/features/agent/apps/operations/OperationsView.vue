<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import { connectionService, type Connection } from '@/features/connections/public';
  import AgentConversation from '../../ai/AgentConversation.vue';
  import { agentEvents } from '../../api/agent-events';
  import { agentApi } from '../../api/agent-api';
  import type {
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
  } from '../../api/agent-api';
  import { agentSurfaceSession } from '../../host/surface-session';
  import { createAgentRunFacade } from '../../runtime/run-facade';
  import TaskDetailDrawer from '../../runtime/TaskDetailDrawer.vue';
  import TaskRail from '../../runtime/TaskRail.vue';

  const props = defineProps<{ appId: string }>();
  const facade = createAgentRunFacade(props.appId);
  const threads = ref<AgentThreadView[]>([]);
  const currentThread = ref<AgentThreadView | null>(null);
  const entries = ref<AgentLedgerEntry[]>([]);
  const nextCursor = ref<string | null>(null);
  const run = ref<AgentRunView | null>(null);
  const definitions = ref<AgentDefinitionView[]>([]);
  const providers = ref<AgentProviderView[]>([]);
  const connections = ref<Connection[]>([]);
  const selectedConnectionIds = ref<number[]>([]);
  const attachments = ref<AgentArtifactRef[]>([]);
  const approvals = ref<AgentApprovalView[]>([]);
  const hardLimits = ref<AgentHardLimits | null>(null);
  const backgroundRuns = ref<AgentRunView[]>([]);
  const detailSnapshot = ref<AgentRunSnapshot | null>(null);
  const detailCheckpoints = ref<AgentCheckpointView[]>([]);
  const detailSubagents = ref<AgentSubagentView[]>([]);
  const selectedSubagentId = ref<string | null>(null);
  const detailSubagentMessages = ref<AgentSubagentMessage[]>([]);
  const detailVisible = ref(false);
  const defaultProviderId = ref<string | null>(null);
  const defaultModelId = ref<string | null>(null);
  const streamingText = ref('');
  const busy = ref(false);
  const loading = ref(true);
  const error = ref('');
  const draft = ref(agentSurfaceSession.state(props.appId).draft);
  let streamAbort: AbortController | null = null;
  let streamGeneration = 0;

  const nonTerminal = new Set(['created', 'running', 'awaiting_approval', 'awaiting_budget', 'cancelling']);
  const providerSelection = computed(() => {
    const enabled = providers.value.filter((provider) => provider.enabled);
    const configured = enabled.find((provider) => provider.id === defaultProviderId.value);
    const provider = configured ?? enabled[0];
    if (!provider) return null;
    const configuredModel = provider.models.find((model) => model.id === defaultModelId.value);
    const model = configuredModel ?? provider.models[0];
    return model ? { provider, model } : null;
  });
  const canSend = computed(() => Boolean(definitions.value[0] && providerSelection.value && currentThread.value));

  const explain = (cause: unknown): string => {
    if (cause && typeof cause === 'object' && 'response' in cause) {
      const response = (cause as { response?: { data?: { error?: { code?: string; message?: string } } } }).response;
      return response?.data?.error?.message || response?.data?.error?.code || 'AGENT_REQUEST_FAILED';
    }
    return cause instanceof Error ? cause.message : 'AGENT_REQUEST_FAILED';
  };

  const refreshLedger = async (): Promise<void> => {
    const thread = currentThread.value;
    if (!thread) return;
    const page = await facade.readLedger(thread.id);
    entries.value = page.items;
    nextCursor.value = page.nextCursor;
  };

  const refreshRun = async (runId: string): Promise<AgentRunView | null> => {
    try {
      const snapshot = await facade.getRun(runId);
      run.value = snapshot;
      return snapshot;
    } catch {
      run.value = null;
      return null;
    }
  };

  const refreshApprovals = async (runId?: string): Promise<void> => {
    if (!runId) {
      approvals.value = [];
      return;
    }
    try {
      approvals.value = await facade.listApprovals(runId);
    } catch {
      approvals.value = [];
    }
  };

  const refreshBackgroundRuns = async (): Promise<void> => {
    const page = await facade.listRuns();
    backgroundRuns.value = page.items.filter(
      (candidate) => nonTerminal.has(candidate.status) && candidate.threadId !== currentThread.value?.id,
    );
  };

  const stopRunStream = (): void => {
    streamGeneration += 1;
    streamAbort?.abort();
    streamAbort = null;
    streamingText.value = '';
  };

  const startRunStream = (initial: AgentRunView): void => {
    stopRunStream();
    const controller = new AbortController();
    streamAbort = controller;
    const generation = ++streamGeneration;
    void (async () => {
      let cursor = initial.eventCursor;
      while (!controller.signal.aborted && generation === streamGeneration) {
        try {
          for await (const event of agentEvents.run(props.appId, initial.id, cursor, controller.signal)) {
            if (controller.signal.aborted || generation !== streamGeneration) return;
            if (event.id) {
              const sequence = Number(event.id.slice(event.id.lastIndexOf(':') + 1));
              if (Number.isSafeInteger(sequence) && sequence >= 0) cursor = sequence;
            }
            if (event.type === 'message.delta') {
              const payload = event.payload as { text?: unknown } | undefined;
              if (payload && typeof payload.text === 'string') streamingText.value += payload.text;
              continue;
            }
            if (event.type === 'message.final') streamingText.value = '';
            const next = await refreshRun(initial.id);
            await Promise.all([
              refreshLedger(),
              refreshApprovals(initial.id),
              refreshBackgroundRuns(),
              ...(detailVisible.value && detailSnapshot.value?.id === initial.id
                ? [refreshDetailSubagents(initial.id)]
                : []),
            ]);
            if (!next || !nonTerminal.has(next.status)) return;
          }
        } catch (cause) {
          if (controller.signal.aborted || generation !== streamGeneration) return;
          error.value = explain(cause);
        }
        await new Promise((resolve) => window.setTimeout(resolve, 800));
      }
    })();
  };

  const selectThread = async (thread: AgentThreadView): Promise<void> => {
    if (currentThread.value?.id === thread.id) return;
    stopRunStream();
    currentThread.value = thread;
    agentSurfaceSession.setThread(props.appId, thread.id);
    await refreshLedger();
    const runs = await facade.listRuns(thread.id);
    const active = runs.items.find((candidate) => nonTerminal.has(candidate.status)) ?? runs.items[0] ?? null;
    run.value = active;
    await refreshApprovals(active?.id);
    if (active && nonTerminal.has(active.status)) startRunStream(active);
    await refreshBackgroundRuns();
  };

  const createThread = async (): Promise<void> => {
    const thread = await facade.createThread();
    threads.value = [thread, ...threads.value];
    await selectThread(thread);
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
      defaultProviderId.value = settings.effectiveSettings.model.defaultProviderId;
      defaultModelId.value = settings.effectiveSettings.model.defaultModelId;
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
    if (busy.value || !currentThread.value) return;
    busy.value = true;
    error.value = '';
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
      draft.value = '';
      attachments.value = [];
      agentSurfaceSession.setDraft(props.appId, '');
      await refreshLedger();
      await Promise.all([refreshApprovals(created.id), refreshBackgroundRuns()]);
      startRunStream(created);
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const cancel = async (): Promise<void> => {
    if (!run.value || busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      run.value = await facade.cancelRun(run.value);
      await Promise.all([refreshLedger(), refreshApprovals(run.value.id), refreshBackgroundRuns()]);
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const increaseBudget = async (increase: Parameters<typeof facade.increaseBudget>[1]): Promise<void> => {
    if (!run.value || busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      run.value = await facade.increaseBudget(run.value, increase);
      await Promise.all([refreshLedger(), refreshApprovals(run.value.id), refreshBackgroundRuns()]);
      if (run.value && nonTerminal.has(run.value.status)) startRunStream(run.value);
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const resolveApproval = async (approval: AgentApprovalView, decision: 'approved' | 'denied'): Promise<void> => {
    if (busy.value || approval.status !== 'requested') return;
    busy.value = true;
    error.value = '';
    try {
      await facade.resolveApproval(approval, decision);
      const next = await refreshRun(approval.runId);
      await Promise.all([refreshApprovals(approval.runId), refreshLedger(), refreshBackgroundRuns()]);
      if (next && nonTerminal.has(next.status)) startRunStream(next);
    } catch (cause) {
      error.value = explain(cause);
      await refreshApprovals(approval.runId);
    } finally {
      busy.value = false;
    }
  };

  const refreshDetailSubagents = async (runId: string): Promise<void> => {
    const page = await facade.listSubagents(runId);
    detailSubagents.value = page.items;
    const selected = detailSubagents.value.find((item) => item.id === selectedSubagentId.value) ?? null;
    if (!selected) {
      selectedSubagentId.value = null;
      detailSubagentMessages.value = [];
    }
  };

  const selectSubagent = async (delegation: AgentSubagentView): Promise<void> => {
    selectedSubagentId.value = delegation.id;
    const page = await facade.listSubagentMessages(delegation.runId, delegation.id);
    detailSubagentMessages.value = page.items;
  };

  const cancelSubagent = async (delegation: AgentSubagentView): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      await facade.cancelSubagent(delegation.runId, delegation);
      await refreshDetailSubagents(delegation.runId);
      if (selectedSubagentId.value === delegation.id) await selectSubagent(delegation);
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const openRunDetail = async (candidate: AgentRunView): Promise<void> => {
    try {
      const [snapshot, checkpoints, subagents] = await Promise.all([
        facade.getRun(candidate.id),
        facade.listCheckpoints(candidate.id),
        facade.listSubagents(candidate.id),
      ]);
      detailSnapshot.value = snapshot;
      detailCheckpoints.value = checkpoints;
      detailSubagents.value = subagents.items;
      selectedSubagentId.value = null;
      detailSubagentMessages.value = [];
      detailVisible.value = true;
    } catch (cause) {
      error.value = explain(cause);
    }
  };

  const saveCheckpoint = async (snapshot: AgentRunSnapshot): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      await facade.saveCheckpoint(snapshot);
      detailCheckpoints.value = await facade.listCheckpoints(snapshot.id);
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const resumeCheckpoint = async (snapshot: AgentRunSnapshot, checkpoint: AgentCheckpointView): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      const resumed = await facade.resumeRun(snapshot, checkpoint.id);
      run.value = resumed;
      detailSnapshot.value = await facade.getRun(resumed.id);
      detailCheckpoints.value = [];
      detailVisible.value = false;
      await Promise.all([refreshLedger(), refreshApprovals(resumed.id), refreshBackgroundRuns()]);
      startRunStream(resumed);
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      busy.value = false;
    }
  };

  const loadOlder = async (): Promise<void> => {
    if (!currentThread.value || !nextCursor.value || busy.value) return;
    busy.value = true;
    try {
      const page = await facade.readLedger(currentThread.value.id, nextCursor.value);
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
  onBeforeUnmount(stopRunStream);
</script>

<template>
  <div class="relative grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_270px]">
    <aside class="min-h-0 overflow-y-auto border-r border-border bg-card p-3">
      <div class="mb-3 flex items-center justify-between gap-2">
        <strong class="text-sm">{{ $t('agent.operations.threads') }}</strong>
        <button type="button" class="rounded px-2 py-1 text-xs hover:bg-header" :disabled="busy" @click="createThread">
          {{ $t('agent.operations.newThread') }}
        </button>
      </div>
      <button
        v-for="thread in threads"
        :key="thread.id"
        type="button"
        class="mb-1 w-full truncate rounded-md px-2 py-2 text-left text-xs hover:bg-header"
        :class="currentThread?.id === thread.id ? 'bg-header font-medium' : ''"
        @click="selectThread(thread)"
      >
        {{ thread.title }}
      </button>
      <div class="mt-4 border-t border-border pt-3">
        <strong class="text-xs">{{ $t('agent.operations.targets') }}</strong>
        <p class="mt-1 text-[11px] text-text-secondary">{{ $t('agent.operations.targetsHint') }}</p>
        <label
          v-for="connection in connections"
          :key="connection.id"
          class="mt-2 flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs hover:bg-header"
        >
          <input
            v-model="selectedConnectionIds"
            type="checkbox"
            :value="connection.id"
            :disabled="Boolean(run && nonTerminal.has(run.status))"
          />
          <span class="min-w-0">
            <span class="block truncate">{{ connection.name || connection.host }}</span>
            <span class="block truncate text-[10px] text-text-secondary"
              >{{ connection.host }}:{{ connection.port }}</span
            >
          </span>
        </label>
        <p v-if="connections.length === 0" class="mt-2 text-[11px] text-text-secondary">
          {{ $t('agent.operations.noTargets') }}
        </p>
      </div>
    </aside>

    <main class="min-h-0 min-w-0">
      <div v-if="loading" class="flex h-full items-center justify-center text-sm text-text-secondary">
        {{ $t('agent.operations.loading') }}
      </div>
      <div
        v-else-if="error && entries.length === 0"
        class="flex h-full items-center justify-center p-6 text-sm text-error"
      >
        {{ error }}
      </div>
      <div v-else class="relative h-full min-h-0">
        <div
          v-if="error"
          class="absolute left-4 right-4 top-3 z-10 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
        >
          {{ error }}
        </div>
        <AgentConversation
          :app-id="appId"
          :entries="entries"
          :next-cursor="nextCursor"
          :run="run"
          :streaming-text="streamingText"
          :draft="draft"
          :busy="busy"
          :can-send="canSend"
          :attachments="attachments"
          @load-older="loadOlder"
          @send="send"
          @cancel="cancel"
          @update-draft="updateDraft"
          @update-attachments="attachments = $event"
        />
      </div>
    </main>

    <div class="hidden min-h-0 xl:block">
      <TaskRail
        :current="run"
        :background-runs="backgroundRuns"
        :hard-limits="hardLimits"
        :approvals="approvals"
        :busy="busy"
        @increase-budget="increaseBudget"
        @resolve-approval="resolveApproval"
        @open-run="openRunDetail"
      />
    </div>

    <TaskDetailDrawer
      :snapshot="detailSnapshot"
      :checkpoints="detailCheckpoints"
      :subagents="detailSubagents"
      :selected-subagent-id="selectedSubagentId"
      :subagent-messages="detailSubagentMessages"
      :visible="detailVisible"
      :busy="busy"
      @close="detailVisible = false"
      @save-checkpoint="saveCheckpoint"
      @resume-checkpoint="resumeCheckpoint"
      @select-subagent="selectSubagent"
      @cancel-subagent="cancelSubagent"
    />
  </div>
</template>
