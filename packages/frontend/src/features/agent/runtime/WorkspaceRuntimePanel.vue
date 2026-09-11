<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    agentApi,
    type AgentAppSummary,
    type AgentArtifactRef,
    type AgentWorkspaceView,
    type PluginInstallation,
    type PluginVersionView,
    type PluginWorkspaceGrant,
    type PluginWorkspacePermission,
    type WorkspaceRuntimeCatalog,
  } from '../api/agent-api';

  const props = defineProps<{ appId: string; runId: string; busy?: boolean }>();
  const { t } = useI18n();

  const catalog = ref<WorkspaceRuntimeCatalog | null>(null);
  const workspaceList = ref<AgentWorkspaceView[]>([]);
  const apps = ref<AgentAppSummary[]>([]);
  const installations = ref<PluginInstallation[]>([]);
  const versions = ref<PluginVersionView[]>([]);
  const artifacts = ref<AgentArtifactRef[]>([]);
  const selectedRecipeId = ref('');
  const createToolVersions = ref<Record<string, string>>({});
  const workspaceToolVersions = ref<Record<string, Record<string, string>>>({});
  const selectedRunnerPluginIds = ref<string[]>([]);
  const retained = ref(false);
  const workspaceKey = ref('');
  const grants = ref<PluginWorkspaceGrant[]>([]);
  const grantPrincipal = ref('');
  const grantPath = ref('/**');
  const grantPermissions = ref<PluginWorkspacePermission[]>(['read', 'list']);
  const exportPath = ref('/');
  const exportName = ref('workspace.bin');
  const exportMediaType = ref('application/octet-stream');
  const importArtifactId = ref('');
  const importPath = ref('/imported.bin');
  const notice = ref('');
  const error = ref('');
  const loading = ref(false);
  const localBusy = ref(false);
  let refreshGeneration = 0;

  const locked = computed(() => Boolean(props.busy) || localBusy.value || loading.value);
  const activeWorkspace = computed(
    () => workspaceList.value.find((workspace) => !['deleted', 'failed'].includes(workspace.status)) ?? null,
  );
  const selectedRecipe = computed(
    () => catalog.value?.recipes.find((recipe) => recipe.id === selectedRecipeId.value) ?? null,
  );
  const packsForFamily = (familyId: string) =>
    (catalog.value?.packs ?? [])
      .filter((pack) => pack.familyId === familyId && pack.status === 'supported')
      .sort((a, b) => b.versionId.localeCompare(a.versionId, undefined, { numeric: true }));
  const selectableFamilies = (recipeId: string): string[] => {
    const recipe = catalog.value?.recipes.find((candidate) => candidate.id === recipeId);
    if (!recipe) return [];
    return recipe.allowedFamilies.filter(
      (familyId) => !recipe.defaultFamilies.includes(familyId) && packsForFamily(familyId).length > 0,
    );
  };
  const createToolFamilies = computed(() => (selectedRecipe.value ? selectableFamilies(selectedRecipe.value.id) : []));
  const pinnedVersion = (workspace: AgentWorkspaceView, familyId: string): string =>
    workspace.profile.toolchain.find((pack) => pack.familyId === familyId)?.versionId ?? '';
  const changedWorkspaceVersions = (workspace: AgentWorkspaceView): Record<string, string> => {
    const draft = workspaceToolVersions.value[workspace.id] ?? {};
    return Object.fromEntries(
      selectableFamilies(workspace.profile.recipeId)
        .filter((familyId) => Boolean(draft[familyId]) && draft[familyId] !== pinnedVersion(workspace, familyId))
        .map((familyId) => [familyId, draft[familyId]!]),
    );
  };
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
  const principalCandidates = computed(() => {
    const selected = selectedWorkspace.value;
    if (!selected) return [];
    return selected.workspace.profile.runnerPlugins.filter((target) => target.pluginId !== selected.targetPluginId);
  });

  const explain = (cause: unknown): string => {
    if (cause && typeof cause === 'object' && 'response' in cause) {
      const response = (cause as { response?: { data?: { error?: { message?: string; code?: string } } } }).response;
      return response?.data?.error?.message || response?.data?.error?.code || t('agent.workspaceRuntime.requestFailed');
    }
    return cause instanceof Error ? cause.message : t('agent.workspaceRuntime.requestFailed');
  };

  const loadGrants = async (): Promise<void> => {
    const selected = selectedWorkspace.value;
    grants.value = [];
    grantPrincipal.value = '';
    if (!selected) return;
    grants.value = await agentApi.workspaceGrants(props.appId, selected.workspace.id, selected.targetPluginId);
    grantPrincipal.value = principalCandidates.value[0]?.pluginId ?? '';
  };

  const refresh = async (): Promise<void> => {
    const current = ++refreshGeneration;
    loading.value = true;
    error.value = '';
    try {
      const [nextCatalog, summaries, nextInstallations, nextVersions, nextWorkspaces, artifactPage] = await Promise.all(
        [
          agentApi.workspaceRuntimeCatalog(),
          agentApi.apps(),
          agentApi.pluginInstallations(),
          agentApi.pluginVersions(),
          agentApi.workspaces(props.appId, props.runId, true),
          agentApi.files({ appId: props.appId }),
        ],
      );
      if (current !== refreshGeneration) return;
      catalog.value = nextCatalog;
      apps.value = summaries;
      installations.value = nextInstallations;
      versions.value = nextVersions;
      artifacts.value = artifactPage.items.filter(
        (artifact) => artifact.appId === props.appId && artifact.status === 'ready',
      );
      workspaceList.value = nextWorkspaces;
      workspaceToolVersions.value = Object.fromEntries(
        nextWorkspaces.map((workspace) => [
          workspace.id,
          Object.fromEntries(workspace.profile.toolchain.map((pack) => [pack.familyId, pack.versionId])),
        ]),
      );
      if (!nextCatalog.recipes.some((recipe) => recipe.id === selectedRecipeId.value)) {
        selectedRecipeId.value = nextCatalog.recipes[0]?.id ?? '';
      }
      createToolVersions.value = Object.fromEntries(
        Object.entries(createToolVersions.value).filter(
          ([familyId, versionId]) =>
            createToolFamilies.value.includes(familyId) &&
            packsForFamily(familyId).some((pack) => pack.versionId === versionId),
        ),
      );
      selectedRunnerPluginIds.value = selectedRunnerPluginIds.value.filter((pluginId) =>
        runnerCandidates.value.some((candidate) => candidate.pluginId === pluginId),
      );
      if (!pluginTargets.value.some((item) => item.key === workspaceKey.value)) {
        workspaceKey.value = pluginTargets.value[0]?.key ?? '';
      }
      if (!artifacts.value.some((artifact) => artifact.id === importArtifactId.value)) {
        importArtifactId.value = artifacts.value[0]?.id ?? '';
      }
      await loadGrants();
    } catch (cause) {
      if (current === refreshGeneration) error.value = explain(cause);
    } finally {
      if (current === refreshGeneration) loading.value = false;
    }
  };

  const run = async (action: () => Promise<void>, success: string): Promise<void> => {
    if (locked.value) return;
    localBusy.value = true;
    error.value = '';
    notice.value = '';
    try {
      await action();
      if (success) notice.value = success;
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      localBusy.value = false;
    }
  };

  const createWorkspace = (): void => {
    if (!selectedRecipeId.value || activeWorkspace.value || !catalog.value) return;
    void run(async () => {
      await agentApi.createWorkspace(
        props.appId,
        props.runId,
        {
          recipeId: selectedRecipeId.value,
          versions: Object.fromEntries(
            Object.entries(createToolVersions.value).filter(([, versionId]) => Boolean(versionId)),
          ),
          runnerPluginIds: [...selectedRunnerPluginIds.value],
        },
        retained.value,
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

  const switchToolVersions = (workspace: AgentWorkspaceView): void => {
    const changes = changedWorkspaceVersions(workspace);
    if (!catalog.value || Object.keys(changes).length === 0) return;
    void run(async () => {
      const result = await agentApi.switchWorkspaceToolVersions(
        props.appId,
        workspace,
        changes,
        catalog.value!.revision,
      );
      if (result.outcome !== 'succeeded') {
        throw new Error(
          result.outcome === 'unknown'
            ? t('agent.workspaceRuntime.versionSwitchUnknown')
            : t('agent.workspaceRuntime.versionSwitchFailed'),
        );
      }
      await refresh();
    }, t('agent.workspaceRuntime.versionSwitched'));
  };

  const replaceGrants = async (next: PluginWorkspaceGrant[]): Promise<void> => {
    const selected = selectedWorkspace.value;
    if (!selected) return;
    grants.value = await agentApi.replaceWorkspaceGrants(
      props.appId,
      selected.workspace.id,
      selected.targetPluginId,
      next.map(({ principalPluginId, path, permissions }) => ({ principalPluginId, path, permissions })),
    );
  };

  const addGrant = (): void => {
    const selected = selectedWorkspace.value;
    if (!selected || !grantPrincipal.value || !grantPath.value.startsWith('/') || grantPermissions.value.length === 0)
      return;
    void run(async () => {
      const next = grants.value.filter(
        (grant) => !(grant.principalPluginId === grantPrincipal.value && grant.path === grantPath.value),
      );
      await replaceGrants([
        ...next,
        {
          targetPluginId: selected.targetPluginId,
          principalPluginId: grantPrincipal.value,
          path: grantPath.value,
          permissions: [...grantPermissions.value],
        },
      ]);
    }, t('agent.workspaceRuntime.grantsSaved'));
  };

  const removeGrant = (index: number): void => {
    void run(async () => {
      await replaceGrants(grants.value.filter((_, candidateIndex) => candidateIndex !== index));
    }, t('agent.workspaceRuntime.grantsSaved'));
  };

  const exportArtifact = (): void => {
    const selected = selectedWorkspace.value;
    if (!selected || !exportPath.value.startsWith('/') || !exportName.value || !exportMediaType.value) return;
    void run(async () => {
      const artifact = await agentApi.exportWorkspaceArtifact(
        props.appId,
        selected.workspace.id,
        selected.targetPluginId,
        { path: exportPath.value, name: exportName.value, mediaType: exportMediaType.value },
      );
      artifacts.value = [artifact, ...artifacts.value.filter((candidate) => candidate.id !== artifact.id)];
      importArtifactId.value ||= artifact.id;
      notice.value = t('agent.workspaceRuntime.exported', { id: artifact.id });
    }, '');
  };

  const importArtifact = (): void => {
    const selected = selectedWorkspace.value;
    if (!selected || !importArtifactId.value || !importPath.value.startsWith('/')) return;
    void run(async () => {
      const result = await agentApi.importArtifactToWorkspace(
        props.appId,
        selected.workspace.id,
        selected.targetPluginId,
        { artifactId: importArtifactId.value, path: importPath.value },
      );
      notice.value = t('agent.workspaceRuntime.imported', { bytes: result.writtenBytes });
    }, '');
  };

  watch(
    () => [props.appId, props.runId] as const,
    () => void refresh(),
    { immediate: true },
  );
  watch(selectedRecipeId, () => {
    createToolVersions.value = {};
  });
  watch(workspaceKey, () => {
    if (!loading.value) void loadGrants().catch((cause) => (error.value = explain(cause)));
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
        :disabled="locked"
        @click="refresh"
      >
        {{ $t('agent.workspaceRuntime.refresh') }}
      </button>
    </div>

    <p v-if="error" class="mt-2 rounded bg-error/10 px-2 py-1 text-[10px] text-error">{{ error }}</p>
    <p v-if="notice" class="mt-2 rounded bg-header px-2 py-1 text-[10px]">{{ notice }}</p>

    <div v-if="catalog && !activeWorkspace" class="mt-3 rounded bg-background p-2">
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="text-[10px] text-text-secondary">
          {{ $t('agent.workspaceRuntime.recipe') }}
          <select v-model="selectedRecipeId" class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs">
            <option v-for="recipe in catalog.recipes" :key="recipe.id" :value="recipe.id">
              {{ recipe.displayName }}
            </option>
          </select>
        </label>
        <label class="flex items-end gap-2 pb-1 text-[10px]">
          <input v-model="retained" type="checkbox" />
          {{ $t('agent.workspaceRuntime.retained') }}
        </label>
      </div>
      <div v-if="createToolFamilies.length" class="mt-2 rounded border border-border p-2">
        <div class="text-[10px] font-medium">{{ $t('agent.workspaceRuntime.toolVersions') }}</div>
        <p class="mt-0.5 text-[9px] text-text-secondary">{{ $t('agent.workspaceRuntime.toolVersionsHint') }}</p>
        <div class="mt-2 grid gap-2 sm:grid-cols-3">
          <label v-for="familyId in createToolFamilies" :key="familyId" class="text-[10px] text-text-secondary">
            {{ familyId }}
            <select
              v-model="createToolVersions[familyId]"
              class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
            >
              <option value="">{{ $t('agent.workspaceRuntime.toolNotSelected') }}</option>
              <option v-for="pack in packsForFamily(familyId)" :key="pack.versionId" :value="pack.versionId">
                {{ pack.versionId }}
              </option>
            </select>
          </label>
        </div>
      </div>
      <div class="mt-2">
        <div class="text-[10px] font-medium">{{ $t('agent.workspaceRuntime.runnerPlugins') }}</div>
        <p class="mt-0.5 text-[9px] text-text-secondary">{{ $t('agent.workspaceRuntime.runnerPluginsHint') }}</p>
        <label
          v-for="plugin in runnerCandidates"
          :key="plugin.pluginId"
          class="mt-1 flex items-center gap-2 text-[10px]"
        >
          <input v-model="selectedRunnerPluginIds" type="checkbox" :value="plugin.pluginId" />
          <span>{{ plugin.displayName }} · {{ plugin.pluginId }} · v{{ plugin.version }}</span>
        </label>
        <p v-if="runnerCandidates.length === 0" class="mt-1 text-[9px] text-text-secondary">
          {{ $t('agent.workspaceRuntime.noRunnerPlugins') }}
        </p>
      </div>
      <button
        type="button"
        class="mt-3 rounded bg-primary px-2 py-1 text-[11px] text-white disabled:opacity-50"
        :disabled="locked || !selectedRecipeId"
        @click="createWorkspace"
      >
        {{ $t('agent.workspaceRuntime.create') }}
      </button>
    </div>

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
        <div
          v-if="selectableFamilies(activeWorkspace.profile.recipeId).length"
          class="mt-2 rounded border border-border p-2"
        >
          <div class="text-[10px] font-medium">{{ $t('agent.workspaceRuntime.workspaceToolVersions') }}</div>
          <p class="mt-0.5 text-[9px] text-text-secondary">
            {{ $t('agent.workspaceRuntime.workspaceToolVersionsHint') }}
          </p>
          <div class="mt-2 grid gap-2 sm:grid-cols-3">
            <label
              v-for="familyId in selectableFamilies(activeWorkspace.profile.recipeId)"
              :key="familyId"
              class="text-[10px] text-text-secondary"
            >
              {{ familyId }}
              <select
                v-model="workspaceToolVersions[activeWorkspace.id][familyId]"
                class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                :disabled="locked"
              >
                <option v-if="!pinnedVersion(activeWorkspace, familyId)" value="">
                  {{ $t('agent.workspaceRuntime.toolNotSelected') }}
                </option>
                <option v-for="pack in packsForFamily(familyId)" :key="pack.versionId" :value="pack.versionId">
                  {{ pack.versionId }}
                </option>
              </select>
            </label>
          </div>
          <button
            type="button"
            class="mt-2 rounded border border-border px-2 py-1 text-[10px] disabled:opacity-50"
            :disabled="locked || Object.keys(changedWorkspaceVersions(activeWorkspace)).length === 0"
            @click="switchToolVersions(activeWorkspace)"
          >
            {{ $t('agent.workspaceRuntime.switchToolVersions') }}
          </button>
        </div>
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

    <div v-if="pluginTargets.length" class="mt-4 border-t border-border pt-3">
      <h4 class="font-medium">{{ $t('agent.workspaceRuntime.workspaceTitle') }}</h4>
      <p class="mt-0.5 text-[9px] text-text-secondary">{{ $t('agent.workspaceRuntime.workspaceHint') }}</p>
      <select
        v-model="workspaceKey"
        class="mt-2 w-full rounded border border-border bg-background px-2 py-1 text-[10px]"
      >
        <option v-for="workspaceTarget in pluginTargets" :key="workspaceTarget.key" :value="workspaceTarget.key">
          {{ workspaceTarget.label }}
        </option>
      </select>

      <div v-if="selectedWorkspace" class="mt-3 rounded bg-background p-2">
        <div class="text-[10px] font-medium">{{ $t('agent.workspaceRuntime.workspaceAcl') }}</div>
        <p v-if="grants.length === 0" class="mt-1 text-[9px] text-text-secondary">
          {{ $t('agent.workspaceRuntime.defaultDeny') }}
        </p>
        <div
          v-for="(grant, index) in grants"
          :key="`${grant.principalPluginId}:${grant.path}`"
          class="mt-2 flex items-start justify-between gap-2 rounded border border-border p-2 text-[9px]"
        >
          <div class="min-w-0 break-words">
            <div class="font-medium">{{ grant.principalPluginId }}</div>
            <div>
              {{ grant.path }} ·
              {{
                grant.permissions.map((permission) => $t(`agent.workspaceRuntime.permission.${permission}`)).join(', ')
              }}
            </div>
          </div>
          <button type="button" class="text-error" :disabled="locked" @click="removeGrant(index)">
            {{ $t('agent.workspaceRuntime.revoke') }}
          </button>
        </div>
        <div v-if="principalCandidates.length" class="mt-3 grid gap-2">
          <select v-model="grantPrincipal" class="rounded border border-border bg-card px-2 py-1 text-[10px]">
            <option v-for="principal in principalCandidates" :key="principal.pluginId" :value="principal.pluginId">
              {{ principal.pluginId }}
            </option>
          </select>
          <input
            v-model.trim="grantPath"
            class="rounded border border-border bg-card px-2 py-1 text-[10px]"
            :placeholder="$t('agent.workspaceRuntime.pathPlaceholder')"
          />
          <div class="flex flex-wrap gap-2 text-[9px]">
            <label
              v-for="permission in ['read', 'write', 'list', 'delete'] as PluginWorkspacePermission[]"
              :key="permission"
              class="flex items-center gap-1"
            >
              <input v-model="grantPermissions" type="checkbox" :value="permission" />
              {{ $t(`agent.workspaceRuntime.permission.${permission}`) }}
            </label>
          </div>
          <button
            type="button"
            class="w-fit rounded border border-border px-2 py-1 text-[10px]"
            :disabled="locked || !grantPrincipal || !grantPath.startsWith('/') || grantPermissions.length === 0"
            @click="addGrant"
          >
            {{ $t('agent.workspaceRuntime.grant') }}
          </button>
        </div>
        <p v-else class="mt-2 text-[9px] text-text-secondary">
          {{ $t('agent.workspaceRuntime.noCrossPluginPrincipal') }}
        </p>
      </div>

      <div v-if="selectedWorkspace" class="mt-3 grid gap-3 sm:grid-cols-2">
        <form class="rounded bg-background p-2" @submit.prevent="exportArtifact">
          <div class="text-[10px] font-medium">{{ $t('agent.workspaceRuntime.exportTitle') }}</div>
          <input
            v-model.trim="exportPath"
            class="mt-2 w-full rounded border border-border bg-card px-2 py-1 text-[10px]"
            :placeholder="$t('agent.workspaceRuntime.workspacePath')"
          />
          <input
            v-model.trim="exportName"
            class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-[10px]"
            :placeholder="$t('agent.workspaceRuntime.artifactName')"
          />
          <input
            v-model.trim="exportMediaType"
            class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-[10px]"
            :placeholder="$t('agent.workspaceRuntime.mediaType')"
          />
          <button type="submit" class="mt-2 rounded border border-border px-2 py-1 text-[10px]" :disabled="locked">
            {{ $t('agent.workspaceRuntime.exportAction') }}
          </button>
        </form>
        <form class="rounded bg-background p-2" @submit.prevent="importArtifact">
          <div class="text-[10px] font-medium">{{ $t('agent.workspaceRuntime.importTitle') }}</div>
          <select
            v-model="importArtifactId"
            class="mt-2 w-full rounded border border-border bg-card px-2 py-1 text-[10px]"
          >
            <option value="">{{ $t('agent.workspaceRuntime.selectArtifact') }}</option>
            <option v-for="artifact in artifacts" :key="artifact.id" :value="artifact.id">
              {{ artifact.originalName }} · {{ artifact.id }}
            </option>
          </select>
          <input
            v-model.trim="importPath"
            class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-[10px]"
            :placeholder="$t('agent.workspaceRuntime.workspacePath')"
          />
          <button type="submit" class="mt-2 rounded border border-border px-2 py-1 text-[10px]" :disabled="locked">
            {{ $t('agent.workspaceRuntime.importAction') }}
          </button>
        </form>
      </div>
    </div>
  </section>
</template>
