<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    agentApi,
    type AgentAppSummary,
    type AgentArtifactRef,
    type EnvironmentCatalog,
    type EnvironmentGroupDetail,
    type EnvironmentView,
    type EnvironmentWorkspaceGrant,
    type EnvironmentWorkspacePermission,
    type PluginInstallation,
    type PluginVersionView,
  } from '../api/agent-api';

  const props = defineProps<{ appId: string; runId: string; busy?: boolean }>();
  const { t } = useI18n();

  const catalog = ref<EnvironmentCatalog | null>(null);
  const groups = ref<EnvironmentGroupDetail[]>([]);
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
  const grants = ref<EnvironmentWorkspaceGrant[]>([]);
  const grantPrincipal = ref('');
  const grantPath = ref('/**');
  const grantPermissions = ref<EnvironmentWorkspacePermission[]>(['read', 'list']);
  const exportPath = ref('/');
  const exportName = ref('workspace.bin');
  const exportMediaType = ref('application/octet-stream');
  const importArtifactId = ref('');
  const importPath = ref('/imported.bin');
  const notice = ref('');
  const error = ref('');
  const loading = ref(false);
  const localBusy = ref(false);
  let generation = 0;

  const locked = computed(() => Boolean(props.busy) || localBusy.value || loading.value);
  const activeGroup = computed(
    () => groups.value.find((group) => !['deleted', 'failed'].includes(group.status)) ?? null,
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
  const pinnedVersion = (environment: EnvironmentView, familyId: string): string =>
    environment.packRefs.find((pack) => pack.familyId === familyId)?.versionId ?? '';
  const changedWorkspaceVersions = (environment: EnvironmentView): Record<string, string> => {
    const draft = workspaceToolVersions.value[environment.id] ?? {};
    return Object.fromEntries(
      selectableFamilies(environment.recipeId)
        .filter((familyId) => Boolean(draft[familyId]) && draft[familyId] !== pinnedVersion(environment, familyId))
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
  const workspaces = computed(() =>
    groups.value.flatMap((group) =>
      group.environments
        .filter((environment) => !['deleted', 'failed'].includes(environment.status))
        .flatMap((environment) =>
          environment.runnerPlugins.map((target) => ({
            key: `${environment.id}::${target.pluginId}`,
            environment,
            targetPluginId: target.pluginId,
            label: `${target.pluginId} · ${environment.kind}`,
          })),
        ),
    ),
  );
  const selectedWorkspace = computed(() => workspaces.value.find((item) => item.key === workspaceKey.value) ?? null);
  const principalCandidates = computed(() => {
    const selected = selectedWorkspace.value;
    if (!selected) return [];
    return selected.environment.runnerPlugins.filter((target) => target.pluginId !== selected.targetPluginId);
  });

  const explain = (cause: unknown): string => {
    if (cause && typeof cause === 'object' && 'response' in cause) {
      const response = (cause as { response?: { data?: { error?: { message?: string; code?: string } } } }).response;
      return response?.data?.error?.message || response?.data?.error?.code || t('agent.environments.requestFailed');
    }
    return cause instanceof Error ? cause.message : t('agent.environments.requestFailed');
  };

  const loadGrants = async (): Promise<void> => {
    const selected = selectedWorkspace.value;
    grants.value = [];
    grantPrincipal.value = '';
    if (!selected) return;
    grants.value = await agentApi.workspaceGrants(props.appId, selected.environment.id, selected.targetPluginId);
    grantPrincipal.value = principalCandidates.value[0]?.pluginId ?? '';
  };

  const refresh = async (): Promise<void> => {
    const current = ++generation;
    loading.value = true;
    error.value = '';
    try {
      const [nextCatalog, summaries, nextInstallations, nextVersions, groupViews, artifactPage] = await Promise.all([
        agentApi.environmentCatalog(),
        agentApi.apps(),
        agentApi.pluginInstallations(),
        agentApi.pluginVersions(),
        agentApi.environmentGroups(props.appId, props.runId, true),
        agentApi.files({ appId: props.appId }),
      ]);
      const details = await Promise.all(groupViews.map((group) => agentApi.environmentGroup(props.appId, group.id)));
      if (current !== generation) return;
      catalog.value = nextCatalog;
      apps.value = summaries;
      installations.value = nextInstallations;
      versions.value = nextVersions;
      artifacts.value = artifactPage.items.filter(
        (artifact) => artifact.appId === props.appId && artifact.status === 'ready',
      );
      groups.value = details;
      workspaceToolVersions.value = Object.fromEntries(
        details.flatMap((group) =>
          group.environments.map((environment) => [
            environment.id,
            Object.fromEntries(environment.packRefs.map((pack) => [pack.familyId, pack.versionId])),
          ]),
        ),
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
      if (!workspaces.value.some((item) => item.key === workspaceKey.value)) {
        workspaceKey.value = workspaces.value[0]?.key ?? '';
      }
      if (!artifacts.value.some((artifact) => artifact.id === importArtifactId.value)) {
        importArtifactId.value = artifacts.value[0]?.id ?? '';
      }
      await loadGrants();
    } catch (cause) {
      if (current === generation) error.value = explain(cause);
    } finally {
      if (current === generation) loading.value = false;
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

  const createEnvironment = (): void => {
    if (!selectedRecipeId.value || activeGroup.value) return;
    void run(async () => {
      await agentApi.createEnvironmentGroup(
        props.appId,
        props.runId,
        [
          {
            recipeId: selectedRecipeId.value,
            versions: Object.fromEntries(
              Object.entries(createToolVersions.value).filter(([, versionId]) => Boolean(versionId)),
            ),
            runnerPluginIds: [...selectedRunnerPluginIds.value],
          },
        ],
        retained.value,
      );
      await refresh();
    }, t('agent.environments.created'));
  };

  const environmentAction = (environment: EnvironmentView, action: 'start' | 'stop' | 'restart' | 'delete'): void => {
    void run(async () => {
      await agentApi.environmentAction(props.appId, environment, action);
      await refresh();
    }, t('agent.environments.actionSubmitted'));
  };

  const switchToolVersions = (environment: EnvironmentView): void => {
    const changes = changedWorkspaceVersions(environment);
    if (!catalog.value || Object.keys(changes).length === 0) return;
    void run(async () => {
      const result = await agentApi.switchEnvironmentVersions(
        props.appId,
        environment,
        changes,
        catalog.value!.revision,
      );
      if (result.outcome !== 'succeeded') {
        throw new Error(
          result.outcome === 'unknown'
            ? t('agent.environments.versionSwitchUnknown')
            : t('agent.environments.versionSwitchFailed'),
        );
      }
      await refresh();
    }, t('agent.environments.versionSwitched'));
  };

  const replaceGrants = async (next: EnvironmentWorkspaceGrant[]): Promise<void> => {
    const selected = selectedWorkspace.value;
    if (!selected) return;
    grants.value = await agentApi.replaceWorkspaceGrants(
      props.appId,
      selected.environment.id,
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
    }, t('agent.environments.grantsSaved'));
  };

  const removeGrant = (index: number): void => {
    void run(async () => {
      await replaceGrants(grants.value.filter((_, candidateIndex) => candidateIndex !== index));
    }, t('agent.environments.grantsSaved'));
  };

  const exportArtifact = (): void => {
    const selected = selectedWorkspace.value;
    if (!selected || !exportPath.value.startsWith('/') || !exportName.value || !exportMediaType.value) return;
    void run(async () => {
      const artifact = await agentApi.exportWorkspaceArtifact(
        props.appId,
        selected.environment.id,
        selected.targetPluginId,
        { path: exportPath.value, name: exportName.value, mediaType: exportMediaType.value },
      );
      artifacts.value = [artifact, ...artifacts.value.filter((candidate) => candidate.id !== artifact.id)];
      importArtifactId.value ||= artifact.id;
      notice.value = t('agent.environments.exported', { id: artifact.id });
    }, '');
  };

  const importArtifact = (): void => {
    const selected = selectedWorkspace.value;
    if (!selected || !importArtifactId.value || !importPath.value.startsWith('/')) return;
    void run(async () => {
      const result = await agentApi.importArtifactToWorkspace(
        props.appId,
        selected.environment.id,
        selected.targetPluginId,
        { artifactId: importArtifactId.value, path: importPath.value },
      );
      notice.value = t('agent.environments.imported', { bytes: result.writtenBytes });
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
        <h3 class="font-medium">{{ $t('agent.environments.title') }}</h3>
        <p class="mt-0.5 text-[10px] text-text-secondary">{{ $t('agent.environments.description') }}</p>
      </div>
      <button
        type="button"
        class="rounded border border-border px-2 py-1 text-[11px]"
        :disabled="locked"
        @click="refresh"
      >
        {{ $t('agent.environments.refresh') }}
      </button>
    </div>

    <p v-if="error" class="mt-2 rounded bg-error/10 px-2 py-1 text-[10px] text-error">{{ error }}</p>
    <p v-if="notice" class="mt-2 rounded bg-header px-2 py-1 text-[10px]">{{ notice }}</p>

    <div v-if="catalog && !activeGroup" class="mt-3 rounded bg-background p-2">
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="text-[10px] text-text-secondary">
          {{ $t('agent.environments.recipe') }}
          <select v-model="selectedRecipeId" class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs">
            <option v-for="recipe in catalog.recipes" :key="recipe.id" :value="recipe.id">
              {{ recipe.displayName }}
            </option>
          </select>
        </label>
        <label class="flex items-end gap-2 pb-1 text-[10px]">
          <input v-model="retained" type="checkbox" />
          {{ $t('agent.environments.retained') }}
        </label>
      </div>
      <div v-if="createToolFamilies.length" class="mt-2 rounded border border-border p-2">
        <div class="text-[10px] font-medium">{{ $t('agent.environments.toolVersions') }}</div>
        <p class="mt-0.5 text-[9px] text-text-secondary">{{ $t('agent.environments.toolVersionsHint') }}</p>
        <div class="mt-2 grid gap-2 sm:grid-cols-3">
          <label v-for="familyId in createToolFamilies" :key="familyId" class="text-[10px] text-text-secondary">
            {{ familyId }}
            <select
              v-model="createToolVersions[familyId]"
              class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
            >
              <option value="">{{ $t('agent.environments.toolNotSelected') }}</option>
              <option v-for="pack in packsForFamily(familyId)" :key="pack.versionId" :value="pack.versionId">
                {{ pack.versionId }}
              </option>
            </select>
          </label>
        </div>
      </div>
      <div class="mt-2">
        <div class="text-[10px] font-medium">{{ $t('agent.environments.runnerPlugins') }}</div>
        <p class="mt-0.5 text-[9px] text-text-secondary">{{ $t('agent.environments.runnerPluginsHint') }}</p>
        <label
          v-for="plugin in runnerCandidates"
          :key="plugin.pluginId"
          class="mt-1 flex items-center gap-2 text-[10px]"
        >
          <input v-model="selectedRunnerPluginIds" type="checkbox" :value="plugin.pluginId" />
          <span>{{ plugin.displayName }} · {{ plugin.pluginId }} · v{{ plugin.version }}</span>
        </label>
        <p v-if="runnerCandidates.length === 0" class="mt-1 text-[9px] text-text-secondary">
          {{ $t('agent.environments.noRunnerPlugins') }}
        </p>
      </div>
      <button
        type="button"
        class="mt-3 rounded bg-primary px-2 py-1 text-[11px] text-white disabled:opacity-50"
        :disabled="locked || !selectedRecipeId"
        @click="createEnvironment"
      >
        {{ $t('agent.environments.create') }}
      </button>
    </div>

    <div v-if="activeGroup" class="mt-3 space-y-2">
      <p class="text-[9px] text-text-secondary">{{ $t('agent.environments.oneGroupPerRuntime') }}</p>
      <article v-for="environment in activeGroup.environments" :key="environment.id" class="rounded bg-background p-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="font-medium">{{ environment.kind }} · {{ environment.recipeId }}</div>
            <div class="mt-0.5 font-mono text-[9px] text-text-secondary">{{ environment.id }}</div>
          </div>
          <span class="rounded bg-header px-1.5 py-0.5 text-[9px]">
            {{ $t(`agent.environments.status.${environment.status}`) }}
          </span>
        </div>
        <p class="mt-1 text-[9px] text-text-secondary">
          {{
            $t('agent.environments.generationAndTargets', {
              generation: environment.generation,
              count: environment.runnerPlugins.length,
            })
          }}
        </p>
        <div v-if="selectableFamilies(environment.recipeId).length" class="mt-2 rounded border border-border p-2">
          <div class="text-[10px] font-medium">{{ $t('agent.environments.workspaceToolVersions') }}</div>
          <p class="mt-0.5 text-[9px] text-text-secondary">{{ $t('agent.environments.workspaceToolVersionsHint') }}</p>
          <div class="mt-2 grid gap-2 sm:grid-cols-3">
            <label
              v-for="familyId in selectableFamilies(environment.recipeId)"
              :key="familyId"
              class="text-[10px] text-text-secondary"
            >
              {{ familyId }}
              <select
                v-model="workspaceToolVersions[environment.id][familyId]"
                class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                :disabled="locked"
              >
                <option v-if="!pinnedVersion(environment, familyId)" value="">
                  {{ $t('agent.environments.toolNotSelected') }}
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
            :disabled="locked || Object.keys(changedWorkspaceVersions(environment)).length === 0"
            @click="switchToolVersions(environment)"
          >
            {{ $t('agent.environments.switchToolVersions') }}
          </button>
        </div>
        <div v-if="environment.runnerPlugins.length" class="mt-1 space-y-1">
          <div
            v-for="target in environment.runnerPlugins"
            :key="target.pluginId"
            class="rounded border border-border px-2 py-1 text-[9px]"
          >
            <div class="font-medium">{{ target.pluginId }}</div>
            <div class="text-text-secondary">
              {{
                $t('agent.environments.targetContract', {
                  version: target.version,
                  sdk: target.sdkVersion,
                  protocol: target.protocolVersion,
                })
              }}
            </div>
            <div class="break-all font-mono text-[8px] text-text-secondary">
              {{ $t('agent.environments.targetSource', { entry: target.entry, hash: target.packageHash }) }}
            </div>
          </div>
        </div>
        <div class="mt-2 flex flex-wrap gap-1">
          <button
            v-if="['ready', 'stopped'].includes(environment.status)"
            type="button"
            class="rounded border border-border px-2 py-1 text-[10px]"
            :disabled="locked"
            @click="environmentAction(environment, 'start')"
          >
            {{ $t('agent.environments.start') }}
          </button>
          <button
            v-if="['running', 'starting'].includes(environment.status)"
            type="button"
            class="rounded border border-border px-2 py-1 text-[10px]"
            :disabled="locked"
            @click="environmentAction(environment, 'stop')"
          >
            {{ $t('agent.environments.stop') }}
          </button>
          <button
            v-if="environment.status === 'running'"
            type="button"
            class="rounded border border-border px-2 py-1 text-[10px]"
            :disabled="locked"
            @click="environmentAction(environment, 'restart')"
          >
            {{ $t('agent.environments.restart') }}
          </button>
          <button
            v-if="!['deleted', 'deleting'].includes(environment.status)"
            type="button"
            class="rounded border border-error/40 px-2 py-1 text-[10px] text-error"
            :disabled="locked"
            @click="environmentAction(environment, 'delete')"
          >
            {{ $t('agent.environments.delete') }}
          </button>
        </div>
      </article>
    </div>

    <div v-if="workspaces.length" class="mt-4 border-t border-border pt-3">
      <h4 class="font-medium">{{ $t('agent.environments.workspaceTitle') }}</h4>
      <p class="mt-0.5 text-[9px] text-text-secondary">{{ $t('agent.environments.workspaceHint') }}</p>
      <select
        v-model="workspaceKey"
        class="mt-2 w-full rounded border border-border bg-background px-2 py-1 text-[10px]"
      >
        <option v-for="workspace in workspaces" :key="workspace.key" :value="workspace.key">
          {{ workspace.label }}
        </option>
      </select>

      <div v-if="selectedWorkspace" class="mt-3 rounded bg-background p-2">
        <div class="text-[10px] font-medium">{{ $t('agent.environments.workspaceAcl') }}</div>
        <p v-if="grants.length === 0" class="mt-1 text-[9px] text-text-secondary">
          {{ $t('agent.environments.defaultDeny') }}
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
              {{ grant.permissions.map((permission) => $t(`agent.environments.permission.${permission}`)).join(', ') }}
            </div>
          </div>
          <button type="button" class="text-error" :disabled="locked" @click="removeGrant(index)">
            {{ $t('agent.environments.revoke') }}
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
            :placeholder="$t('agent.environments.pathPlaceholder')"
          />
          <div class="flex flex-wrap gap-2 text-[9px]">
            <label
              v-for="permission in ['read', 'write', 'list', 'delete'] as EnvironmentWorkspacePermission[]"
              :key="permission"
              class="flex items-center gap-1"
            >
              <input v-model="grantPermissions" type="checkbox" :value="permission" />
              {{ $t(`agent.environments.permission.${permission}`) }}
            </label>
          </div>
          <button
            type="button"
            class="w-fit rounded border border-border px-2 py-1 text-[10px]"
            :disabled="locked || !grantPrincipal || !grantPath.startsWith('/') || grantPermissions.length === 0"
            @click="addGrant"
          >
            {{ $t('agent.environments.grant') }}
          </button>
        </div>
        <p v-else class="mt-2 text-[9px] text-text-secondary">{{ $t('agent.environments.noCrossPluginPrincipal') }}</p>
      </div>

      <div v-if="selectedWorkspace" class="mt-3 grid gap-3 sm:grid-cols-2">
        <form class="rounded bg-background p-2" @submit.prevent="exportArtifact">
          <div class="text-[10px] font-medium">{{ $t('agent.environments.exportTitle') }}</div>
          <input
            v-model.trim="exportPath"
            class="mt-2 w-full rounded border border-border bg-card px-2 py-1 text-[10px]"
            :placeholder="$t('agent.environments.workspacePath')"
          />
          <input
            v-model.trim="exportName"
            class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-[10px]"
            :placeholder="$t('agent.environments.artifactName')"
          />
          <input
            v-model.trim="exportMediaType"
            class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-[10px]"
            :placeholder="$t('agent.environments.mediaType')"
          />
          <button type="submit" class="mt-2 rounded border border-border px-2 py-1 text-[10px]" :disabled="locked">
            {{ $t('agent.environments.exportAction') }}
          </button>
        </form>
        <form class="rounded bg-background p-2" @submit.prevent="importArtifact">
          <div class="text-[10px] font-medium">{{ $t('agent.environments.importTitle') }}</div>
          <select
            v-model="importArtifactId"
            class="mt-2 w-full rounded border border-border bg-card px-2 py-1 text-[10px]"
          >
            <option value="">{{ $t('agent.environments.selectArtifact') }}</option>
            <option v-for="artifact in artifacts" :key="artifact.id" :value="artifact.id">
              {{ artifact.originalName }} · {{ artifact.id }}
            </option>
          </select>
          <input
            v-model.trim="importPath"
            class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-[10px]"
            :placeholder="$t('agent.environments.workspacePath')"
          />
          <button type="submit" class="mt-2 rounded border border-border px-2 py-1 text-[10px]" :disabled="locked">
            {{ $t('agent.environments.importAction') }}
          </button>
        </form>
      </div>
    </div>
  </section>
</template>
