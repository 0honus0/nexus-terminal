<script setup lang="ts">
  import { computed, onBeforeUnmount, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    agentApi,
    formatAgentApiError,
    type AgentAppSummary,
    type AgentArtifactRef,
    type AgentWorkspaceView,
    type AgentSettingsView,
    type PluginInstallation,
    type PluginVersionView,
    type WorkspaceRuntimeCatalog,
  } from '../api/agent-api';
  import WorkspaceArtifactTransfer from './WorkspaceArtifactTransfer.vue';
  import AgentWorkspaceTerminal from './AgentWorkspaceTerminal.vue';
  import WorkspaceCreateCard from './WorkspaceCreateCard.vue';
  import WorkspaceToolchainCard from './WorkspaceToolchainCard.vue';
  import { createRuntimeOperationState } from './runtime-operation-state';

  const props = defineProps<{ appId: string; runId: string; busy?: boolean }>();
  const { t } = useI18n();

  const catalog = ref<WorkspaceRuntimeCatalog | null>(null);
  const workspaceList = ref<AgentWorkspaceView[]>([]);
  const apps = ref<AgentAppSummary[]>([]);
  const installations = ref<PluginInstallation[]>([]);
  const versions = ref<PluginVersionView[]>([]);
  const artifacts = ref<AgentArtifactRef[]>([]);
  const agentSettings = ref<AgentSettingsView | null>(null);
  const workspaceKey = ref('');
  const notice = ref('');
  const error = ref('');
  const loading = ref(false);
  const localBusy = ref(false);
  let refreshGeneration = 0;
  const operationState = createRuntimeOperationState();

  const activeWorkspace = computed(
    () => workspaceList.value.find((workspace) => !['deleted', 'failed'].includes(workspace.status)) ?? null,
  );
  const runnerCandidates = computed(() =>
    installations.value
      .filter((installation) => installation.status === 'installed')
      .map((installation) => {
        const plugin = versions.value.find(
          (version) =>
            version.appId === installation.appId &&
            version.version === installation.version &&
            version.status === 'installed' &&
            Boolean(version.runnerEntry),
        );
        const app = apps.value.find((candidate) => candidate.id === installation.appId && candidate.enabled);
        return plugin && app
          ? { pluginId: installation.appId, version: installation.version, displayName: app.displayName }
          : null;
      })
      .filter((candidate): candidate is { pluginId: string; version: string; displayName: string } =>
        Boolean(candidate),
      ),
  );
  const pluginTargets = computed(() =>
    workspaceList.value
      .filter((workspace) => !['deleted', 'failed'].includes(workspace.status))
      .flatMap((workspace) =>
        workspace.profile.runnerPlugins.map((target) => ({
          key: `${workspace.id}::${target.pluginId}`,
          workspace,
          targetPluginId: target.pluginId,
          label: `${target.pluginId} · ${workspace.profile.kind}`,
        })),
      ),
  );
  const selectedWorkspace = computed(() => pluginTargets.value.find((item) => item.key === workspaceKey.value) ?? null);

  const refreshLocked = computed(() => Boolean(props.busy) || localBusy.value || loading.value);
  const locked = computed(() => refreshLocked.value || operationState.mutationBlocked.value);

  const explain = (cause: unknown): string => formatAgentApiError(cause, t('agent.workspaceRuntime.requestFailed'));

  const refresh = async (preserveError = false): Promise<boolean> => {
    const current = ++refreshGeneration;
    loading.value = true;
    if (!preserveError) error.value = '';
    try {
      const [nextCatalog, summaries, nextInstallations, nextVersions, nextWorkspaces, artifactPage, nextSettings] =
        await Promise.all([
          agentApi.workspaceRuntimeCatalog(),
          agentApi.apps(),
          agentApi.pluginInstallations(),
          agentApi.pluginVersions(),
          agentApi.workspaces(props.appId, props.runId, true),
          agentApi.files({ appId: props.appId }),
          agentApi.settings(),
        ]);
      if (current !== refreshGeneration) return false;
      catalog.value = nextCatalog;
      apps.value = summaries;
      installations.value = nextInstallations;
      versions.value = nextVersions;
      artifacts.value = artifactPage.items.filter(
        (artifact) => artifact.appId === props.appId && artifact.status === 'ready',
      );
      workspaceList.value = nextWorkspaces;
      agentSettings.value = nextSettings;
      if (!pluginTargets.value.some((item) => item.key === workspaceKey.value)) {
        workspaceKey.value = pluginTargets.value[0]?.key ?? '';
      }
      return true;
    } catch (cause) {
      if (current === refreshGeneration) error.value = explain(cause);
      return false;
    } finally {
      if (current === refreshGeneration) loading.value = false;
    }
  };

  const run = async (action: () => Promise<void | 'reconciling'>, success: string): Promise<void> => {
    if (locked.value) return;
    localBusy.value = true;
    operationState.beginMutation();
    error.value = '';
    notice.value = '';
    try {
      const outcome = await action();
      if (outcome === 'reconciling') return;
      operationState.succeed();
      if (success) notice.value = success;
    } catch (cause) {
      const decision = operationState.fail(cause);
      const message = explain(cause);
      const refreshed = decision.refreshAuthoritativeState ? await refresh(true) : false;
      if (decision.phase === 'conflict' && refreshed) operationState.succeed();
      error.value = message;
    } finally {
      localBusy.value = false;
    }
  };

  const createWorkspace = (input: {
    recipeId: string;
    versions: Record<string, string>;
    runnerPluginIds: string[];
    acpProfileIds: string[];
    browserTargetId: string;
    retained: boolean;
  }): void => {
    if (activeWorkspace.value || !catalog.value) return;
    void run(async () => {
      await agentApi.createWorkspace(
        props.appId,
        props.runId,
        {
          recipeId: input.recipeId,
          versions: input.versions,
          runnerPluginIds: input.runnerPluginIds,
          ...(input.acpProfileIds.length ? { acpProfileIds: input.acpProfileIds } : {}),
          ...(input.browserTargetId ? { browserTargetId: input.browserTargetId } : {}),
        },
        input.retained,
        catalog.value!.revision,
      );
      await refresh();
    }, t('agent.workspaceRuntime.created'));
  };

  const workspaceAction = (workspace: AgentWorkspaceView, action: 'start' | 'stop' | 'restart' | 'delete'): void => {
    void run(async () => {
      await agentApi.workspaceAction(props.appId, workspace, action);
      await refresh();
    }, t('agent.workspaceRuntime.actionSubmitted'));
  };

  const switchToolVersions = (workspace: AgentWorkspaceView, changes: Record<string, string>): void => {
    if (!catalog.value || Object.keys(changes).length === 0) return;
    void run(async () => {
      const result = await agentApi.switchWorkspaceToolVersions(
        props.appId,
        workspace,
        changes,
        catalog.value!.revision,
      );
      if (result.outcome === 'unknown') {
        const commandIds = result.commands
          .filter((command) => ['pending', 'running', 'unknown'].includes(command.status))
          .map((command) => command.id);
        operationState.markReconciling(
          'WORKSPACE_OUTCOME_UNKNOWN',
          t('agent.workspaceRuntime.versionSwitchUnknown'),
          commandIds,
        );
        await refresh(true);
        error.value = t('agent.workspaceRuntime.versionSwitchUnknown');
        return 'reconciling';
      }
      if (result.outcome === 'failed') throw new Error(t('agent.workspaceRuntime.versionSwitchFailed'));
      await refresh();
    }, t('agent.workspaceRuntime.versionSwitched'));
  };

  const switchActiveToolVersions = (changes: Record<string, string>): void => {
    if (!activeWorkspace.value) return;
    switchToolVersions(activeWorkspace.value, changes);
  };

  const exportArtifact = (input: { path: string; name: string; mediaType: string }): void => {
    const selected = selectedWorkspace.value;
    if (!selected) return;
    void run(async () => {
      const artifact = await agentApi.exportWorkspaceArtifact(
        props.appId,
        selected.workspace.id,
        selected.targetPluginId,
        input,
      );
      artifacts.value = [artifact, ...artifacts.value.filter((candidate) => candidate.id !== artifact.id)];
      notice.value = t('agent.workspaceRuntime.exported', { id: artifact.id });
    }, '');
  };

  const importArtifact = (input: { artifactId: string; path: string }): void => {
    const selected = selectedWorkspace.value;
    if (!selected) return;
    void run(async () => {
      const result = await agentApi.importArtifactToWorkspace(
        props.appId,
        selected.workspace.id,
        selected.targetPluginId,
        input,
      );
      notice.value = t('agent.workspaceRuntime.imported', { bytes: result.writtenBytes });
    }, '');
  };

  const verifyUnknownOutcome = async (): Promise<void> => {
    const commandIds = [...operationState.reconciliationCommandIds.value];
    if (operationState.phase.value !== 'reconciling' || commandIds.length === 0 || localBusy.value) return;
    localBusy.value = true;
    try {
      const commands = await Promise.all(commandIds.map((commandId) => agentApi.workspaceRuntimeCommand(commandId)));
      const unresolved = commands
        .filter((command) => ['pending', 'running', 'unknown'].includes(command.status))
        .map((command) => command.id);
      operationState.updateReconciliationCommands(unresolved);
      await refresh(true);
      if (unresolved.length === 0) {
        operationState.succeed();
        error.value = '';
        notice.value = t('agent.workspaceRuntime.reconciliationResolved');
      } else {
        error.value = t('agent.workspaceRuntime.reconciliationPending');
      }
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      localBusy.value = false;
    }
  };

  watch(
    () => [props.appId, props.runId] as const,
    () => void refresh(),
    { immediate: true },
  );
  onBeforeUnmount(() => {
    refreshGeneration += 1;
  });
</script>

<template>
  <section class="mt-4 rounded border border-border p-3">
    <div class="flex items-center justify-between gap-2">
      <div>
        <h3 class="font-medium">{{ $t('agent.workspaceRuntime.title') }}</h3>
        <p class="mt-0.5 text-[10px] text-text-secondary">{{ $t('agent.workspaceRuntime.description') }}</p>
      </div>
      <button
        type="button"
        class="rounded border border-border px-2 py-1 text-[11px]"
        :disabled="refreshLocked"
        @click="void refresh()"
      >
        {{ $t('agent.workspaceRuntime.refresh') }}
      </button>
    </div>

    <p v-if="error" class="mt-2 rounded bg-error/10 px-2 py-1 text-[10px] text-error">{{ error }}</p>
    <p v-if="notice" class="mt-2 rounded bg-header px-2 py-1 text-[10px]">{{ notice }}</p>

    <div
      v-if="operationState.phase.value === 'reconciling'"
      class="mt-2 flex items-center justify-between gap-2 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[10px]"
    >
      <span>{{ $t('agent.workspaceRuntime.reconciliationRequired') }}</span>
      <button
        v-if="operationState.reconciliationCommandIds.value.length"
        type="button"
        class="shrink-0 rounded border border-warning/50 px-2 py-1 font-medium"
        :disabled="refreshLocked"
        @click="verifyUnknownOutcome"
      >
        {{ $t('agent.workspaceRuntime.verifyOutcome') }}
      </button>
    </div>

    <WorkspaceCreateCard
      v-if="catalog && agentSettings && !activeWorkspace"
      :catalog="catalog"
      :runner-candidates="runnerCandidates"
      :acp-profiles="agentSettings!.effectiveSettings.workspaceRuntime.acpProfiles"
      :browser-targets="agentSettings!.effectiveSettings.browser.targets"
      :locked="locked"
      @create="createWorkspace"
    />

    <div v-if="activeWorkspace" class="mt-3 space-y-2">
      <p class="text-[9px] text-text-secondary">{{ $t('agent.workspaceRuntime.oneWorkspacePerRuntime') }}</p>
      <article class="rounded bg-background p-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="font-medium">{{ activeWorkspace.profile.kind }} · {{ activeWorkspace.profile.recipeId }}</div>
            <div class="mt-0.5 font-mono text-[9px] text-text-secondary">{{ activeWorkspace.id }}</div>
          </div>
          <span class="rounded bg-header px-1.5 py-0.5 text-[9px]">
            {{ $t(`agent.workspaceRuntime.status.${activeWorkspace.status}`) }}
          </span>
        </div>
        <p class="mt-1 text-[9px] text-text-secondary">
          {{
            $t('agent.workspaceRuntime.generationAndTargets', {
              generation: activeWorkspace.generation,
              count: activeWorkspace.profile.runnerPlugins.length,
            })
          }}
        </p>
        <WorkspaceToolchainCard
          v-if="catalog"
          :workspace="activeWorkspace"
          :catalog="catalog"
          :locked="locked"
          @switch="switchActiveToolVersions"
        />
        <AgentWorkspaceTerminal
          :app-id="props.appId"
          :workspace-id="activeWorkspace.id"
          :generation="activeWorkspace.generation"
          :running="activeWorkspace.status === 'running'"
        />
        <div v-if="activeWorkspace.profile.runnerPlugins.length" class="mt-1 space-y-1">
          <div
            v-for="target in activeWorkspace.profile.runnerPlugins"
            :key="target.pluginId"
            class="rounded border border-border px-2 py-1 text-[9px]"
          >
            <div class="font-medium">{{ target.pluginId }}</div>
            <div class="text-text-secondary">
              {{
                $t('agent.workspaceRuntime.targetContract', {
                  version: target.version,
                  sdk: target.sdkVersion,
                  protocol: target.protocolVersion,
                })
              }}
            </div>
            <div class="break-all font-mono text-[8px] text-text-secondary">
              {{ $t('agent.workspaceRuntime.targetSource', { entry: target.entry, hash: target.packageHash }) }}
            </div>
          </div>
        </div>
        <div class="mt-2 flex flex-wrap gap-1">
          <button
            v-if="['ready', 'stopped'].includes(activeWorkspace.status)"
            type="button"
            class="rounded border border-border px-2 py-1 text-[10px]"
            :disabled="locked"
            @click="workspaceAction(activeWorkspace, 'start')"
          >
            {{ $t('agent.workspaceRuntime.start') }}
          </button>
          <button
            v-if="['running', 'starting'].includes(activeWorkspace.status)"
            type="button"
            class="rounded border border-border px-2 py-1 text-[10px]"
            :disabled="locked"
            @click="workspaceAction(activeWorkspace, 'stop')"
          >
            {{ $t('agent.workspaceRuntime.stop') }}
          </button>
          <button
            v-if="activeWorkspace.status === 'running'"
            type="button"
            class="rounded border border-border px-2 py-1 text-[10px]"
            :disabled="locked"
            @click="workspaceAction(activeWorkspace, 'restart')"
          >
            {{ $t('agent.workspaceRuntime.restart') }}
          </button>
          <button
            v-if="!['deleted', 'deleting'].includes(activeWorkspace.status)"
            type="button"
            class="rounded border border-error/40 px-2 py-1 text-[10px] text-error"
            :disabled="locked"
            @click="workspaceAction(activeWorkspace, 'delete')"
          >
            {{ $t('agent.workspaceRuntime.delete') }}
          </button>
        </div>
      </article>
    </div>

    <WorkspaceArtifactTransfer
      v-if="selectedWorkspace"
      :artifacts="artifacts"
      :locked="locked"
      @export="exportArtifact"
      @import="importArtifact"
    />
  </section>
</template>
