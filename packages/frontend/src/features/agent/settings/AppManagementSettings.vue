<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseModal, UiButton, UiCheckbox } from '@/foundation/ui';
  import { useOperationFeedback } from '@/shared/feedback/public';
  import {
    agentApi,
    formatAgentApiError,
    type AgentAppGrantViewDto,
    type AgentAppSummaryDto,
    type AgentCapabilityDefinitionDto,
    type AgentCapabilityGrantInputDto,
    type AgentCapabilityScopeDto,
    type AgentTargetGrantSelectionDto,
    type AgentTargetKindDto,
  } from '../api/agent-api';

  const props = defineProps<{ apps: AgentAppSummaryDto[]; busy: boolean }>();
  const emit = defineEmits<{
    toggle: [app: AgentAppSummaryDto, enabled: boolean];
    grantsUpdated: [app: AgentAppSummaryDto];
    refresh: [];
  }>();
  const { t } = useI18n();
  const operationFeedback = useOperationFeedback('agent.settings.apps');

  const grantViews = ref<Record<string, AgentAppGrantViewDto>>({});
  const drafts = ref<Record<string, AgentCapabilityGrantInputDto[]>>({});
  const grantBusy = ref<Record<string, boolean>>({});
  const grantErrors = ref<Record<string, string>>({});
  const expandedGrants = ref<Record<string, boolean>>({});
  const grantLoadGeneration = new Map<string, number>();

  const explain = (cause: unknown): string => formatAgentApiError(cause, 'AGENT_REQUEST_FAILED');
  type CapabilityId = AgentCapabilityGrantInputDto['capability'];

  const cloneSelection = (selection: AgentTargetGrantSelectionDto): AgentTargetGrantSelectionDto =>
    selection.mode === 'all' ? { mode: 'all' } : { mode: 'ids', ids: [...selection.ids] };

  const cloneScope = (scope: AgentCapabilityScopeDto): AgentCapabilityScopeDto => {
    if (scope.kind === 'global') return { kind: 'global' };
    return {
      kind: 'targets',
      targets: Object.fromEntries(
        Object.entries(scope.targets).map(([target, selection]) => [
          target,
          cloneSelection(selection as AgentTargetGrantSelectionDto),
        ]),
      ) as Partial<Record<AgentTargetKindDto, AgentTargetGrantSelectionDto>>,
    };
  };

  const cloneGrant = (grant: AgentCapabilityGrantInputDto): AgentCapabilityGrantInputDto => ({
    capability: grant.capability,
    scope: cloneScope(grant.scope),
  });

  const definitionFor = (appId: string, capability: CapabilityId): AgentCapabilityDefinitionDto | undefined =>
    grantViews.value[appId]?.capabilityDefinitions.find((definition) => definition.id === capability);

  const grantFor = (appId: string, capability: CapabilityId): AgentCapabilityGrantInputDto | undefined =>
    (drafts.value[appId] ?? []).find((grant) => grant.capability === capability);

  const loadGrant = async (appId: string): Promise<void> => {
    const generation = (grantLoadGeneration.get(appId) ?? 0) + 1;
    grantLoadGeneration.set(appId, generation);
    try {
      const view = await agentApi.appGrants(appId);
      if (grantLoadGeneration.get(appId) !== generation) return;
      grantViews.value = { ...grantViews.value, [appId]: view };
      drafts.value = {
        ...drafts.value,
        [appId]: view.grants.map((grant) => cloneGrant(grant)),
      };
      const next = { ...grantErrors.value };
      delete next[appId];
      grantErrors.value = next;
    } catch (cause) {
      if (grantLoadGeneration.get(appId) !== generation) return;
      const message = explain(cause);
      grantErrors.value = { ...grantErrors.value, [appId]: message };
      operationFeedback.logError({ operation: 'load-grants', message, cause, context: { appId } });
    }
  };

  watch(
    () => props.apps.map((app) => `${app.id}@${app.version}#${app.stateVersion}`).join('|'),
    () => {
      for (const app of props.apps) void loadGrant(app.id);
    },
    { immediate: true },
  );

  const checked = (appId: string, capability: CapabilityId): boolean => grantFor(appId, capability) !== undefined;

  const canonicalGrants = (grants: readonly AgentCapabilityGrantInputDto[]): string =>
    JSON.stringify(
      [...grants]
        .map((grant) => cloneGrant(grant))
        .sort((left, right) => left.capability.localeCompare(right.capability)),
    );

  const grantChanged = (appId: string): boolean => {
    const view = grantViews.value[appId];
    if (!view) return false;
    return canonicalGrants(view.grants) !== canonicalGrants(drafts.value[appId] ?? []);
  };

  const toggleCapability = (appId: string, capability: CapabilityId, enabled: boolean): void => {
    const current = (drafts.value[appId] ?? []).filter((grant) => grant.capability !== capability).map(cloneGrant);
    if (enabled) {
      const definition = definitionFor(appId, capability);
      if (!definition) return;
      current.push({ capability, scope: cloneScope(definition.defaultScope) });
    }
    drafts.value = { ...drafts.value, [appId]: current };
  };

  const onCapabilityChange = (appId: string, capability: CapabilityId, checked: boolean): void => {
    toggleCapability(appId, capability, checked);
  };

  const updateGrantScope = (
    appId: string,
    capability: CapabilityId,
    update: (scope: AgentCapabilityScopeDto) => AgentCapabilityScopeDto,
  ): void => {
    drafts.value = {
      ...drafts.value,
      [appId]: (drafts.value[appId] ?? []).map((grant) =>
        grant.capability === capability ? { capability, scope: update(cloneScope(grant.scope)) } : cloneGrant(grant),
      ),
    };
  };

  const targetScopeSelection = (
    appId: string,
    capability: CapabilityId,
    target: AgentTargetKindDto,
  ): AgentTargetGrantSelectionDto | undefined => {
    const scope = grantFor(appId, capability)?.scope;
    return scope?.kind === 'targets' ? scope.targets[target] : undefined;
  };

  const targetEnabled = (appId: string, capability: CapabilityId, target: AgentTargetKindDto): boolean =>
    targetScopeSelection(appId, capability, target) !== undefined;

  const targetLabel = (target: AgentTargetKindDto): string => (target === 'workspace' ? 'Workspace' : 'SSH');

  const setTargetEnabled = (
    appId: string,
    capability: CapabilityId,
    target: AgentTargetKindDto,
    enabled: boolean,
  ): void => {
    updateGrantScope(appId, capability, (scope) => {
      if (scope.kind !== 'targets') return scope;
      const targets = { ...scope.targets };
      if (enabled) targets[target] = { mode: 'all' };
      else delete targets[target];
      return { kind: 'targets', targets };
    });
  };

  const onTargetEnabledChange = (
    appId: string,
    capability: CapabilityId,
    target: AgentTargetKindDto,
    checked: boolean,
  ): void => {
    setTargetEnabled(appId, capability, target, checked);
  };

  const setTargetMode = (
    appId: string,
    capability: CapabilityId,
    target: AgentTargetKindDto,
    mode: AgentTargetGrantSelectionDto['mode'],
  ): void => {
    updateGrantScope(appId, capability, (scope) => {
      if (scope.kind !== 'targets') return scope;
      const current = scope.targets[target];
      return {
        kind: 'targets',
        targets: {
          ...scope.targets,
          [target]:
            mode === 'all' ? { mode: 'all' } : { mode: 'ids', ids: current?.mode === 'ids' ? [...current.ids] : [] },
        },
      };
    });
  };

  const onTargetModeChange = (
    appId: string,
    capability: CapabilityId,
    target: AgentTargetKindDto,
    event: Event,
  ): void => {
    const input = event.target;
    if (input instanceof HTMLSelectElement && (input.value === 'all' || input.value === 'ids')) {
      setTargetMode(appId, capability, target, input.value);
    }
  };

  const targetIdsValue = (appId: string, capability: CapabilityId, target: AgentTargetKindDto): string => {
    const selection = targetScopeSelection(appId, capability, target);
    return selection?.mode === 'ids' ? selection.ids.join(', ') : '';
  };

  const onTargetIdsInput = (
    appId: string,
    capability: CapabilityId,
    target: AgentTargetKindDto,
    event: Event,
  ): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const ids = [
      ...new Set(
        input.value
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ].slice(0, 256);
    updateGrantScope(appId, capability, (scope) =>
      scope.kind === 'targets'
        ? { kind: 'targets', targets: { ...scope.targets, [target]: { mode: 'ids', ids } } }
        : scope,
    );
  };

  const categoryCount = (appId: string, catId: string) => {
    const declared =
      grantViews.value[appId]?.capabilityDefinitions
        .map((definition) => definition.id)
        .filter((capability) => getCapabilityMeta(capability).category === catId) ?? [];
    const checkedNum = declared.filter((capability) => checked(appId, capability)).length;
    return { checked: checkedNum, total: declared.length };
  };

  type CapabilitySelectionState = 'none' | 'partial' | 'all';

  const capabilitySelectionState = (appId: string): CapabilitySelectionState => {
    const definitions = grantViews.value[appId]?.capabilityDefinitions ?? [];
    if (definitions.length === 0) return 'none';
    const selected = definitions.filter((definition) => checked(appId, definition.id)).length;
    if (selected === 0) return 'none';
    if (selected === definitions.length) return 'all';
    return 'partial';
  };

  const toggleAllCapabilities = (appId: string): void => {
    const view = grantViews.value[appId];
    if (!view) return;
    drafts.value = {
      ...drafts.value,
      [appId]:
        capabilitySelectionState(appId) === 'all'
          ? []
          : view.capabilityDefinitions.map((definition) => ({
              capability: definition.id,
              scope: cloneScope(definition.defaultScope),
            })),
    };
  };

  const saveGrants = async (appId: string): Promise<void> => {
    const view = grantViews.value[appId];
    if (!view || grantBusy.value[appId] || props.busy) return;
    grantBusy.value = { ...grantBusy.value, [appId]: true };
    try {
      const updated = await agentApi.replaceAppGrants(
        appId,
        (drafts.value[appId] ?? []).map(cloneGrant),
        view.policyRevision,
      );
      grantViews.value = { ...grantViews.value, [appId]: updated };
      drafts.value = { ...drafts.value, [appId]: updated.grants.map((grant) => cloneGrant(grant)) };
      const next = { ...grantErrors.value };
      delete next[appId];
      grantErrors.value = next;
      emit('grantsUpdated', updated.app);
    } catch (cause) {
      operationFeedback.notifyError({ operation: 'save-grants', message: explain(cause), cause, context: { appId } });
      await loadGrant(appId);
    } finally {
      grantBusy.value = { ...grantBusy.value, [appId]: false };
    }
  };

  const enabledCount = computed(() => props.apps.filter((a) => a.enabled).length);

  // 卸载应用状态与模态弹窗
  const uninstallModalOpen = ref(false);
  const targetUninstallApp = ref<AgentAppSummaryDto | null>(null);
  const uninstallBusy = ref(false);
  const deleteDataOnUninstall = ref(false);

  const requestUninstall = (app: AgentAppSummaryDto) => {
    if (app.enabled || app.surface === 'builtin') return;
    targetUninstallApp.value = app;
    deleteDataOnUninstall.value = false;
    uninstallModalOpen.value = true;
  };

  const confirmUninstall = async () => {
    const app = targetUninstallApp.value;
    if (!app || uninstallBusy.value || props.busy) return;
    uninstallBusy.value = true;
    try {
      const result = await agentApi.uninstallPlugin(app.id, app.stateVersion);
      if (result.state === 'draining') {
        uninstallModalOpen.value = false;
        targetUninstallApp.value = null;
        emit('refresh');
        operationFeedback.notifyWarning(t('agent.settings.apps.drainingNotice'));
        return;
      }
      if (deleteDataOnUninstall.value) {
        try {
          await agentApi.deletePluginData(app.id, true);
        } catch (cause) {
          operationFeedback.notifyError({
            operation: 'delete-plugin-data',
            message: formatAgentApiError(cause, t('agent.settings.apps.deleteDataFailed')),
            cause,
            context: { appId: app.id },
          });
        }
      }
      uninstallModalOpen.value = false;
      targetUninstallApp.value = null;
      emit('refresh');
      operationFeedback.notifySuccess(t('agent.settings.apps.uninstallSuccess'));
    } catch (cause) {
      operationFeedback.notifyError({
        operation: 'uninstall-plugin',
        message: formatAgentApiError(cause, t('agent.settings.apps.uninstallFailed')),
        cause,
        context: { appId: app.id },
      });
    } finally {
      uninstallBusy.value = false;
    }
  };

  interface CapabilityMeta {
    category: 'files' | 'execution' | 'machine' | 'workspace' | 'browser' | 'integration' | 'data';
    icon: string;
    name?: string;
    desc?: string;
  }

  const CAPABILITY_METAS: Record<string, CapabilityMeta> = {
    'file.read': {
      category: 'files',
      icon: 'fa-solid fa-file-lines',
    },
    'file.write': {
      category: 'files',
      icon: 'fa-solid fa-file-pen',
    },
    'file.delete': {
      category: 'files',
      icon: 'fa-solid fa-trash-can',
    },
    'machine.inspect': {
      category: 'machine',
      icon: 'fa-solid fa-chart-line',
    },
    'shell.execute': {
      category: 'execution',
      icon: 'fa-solid fa-terminal',
    },
    'machine.docker.manage': {
      category: 'machine',
      icon: 'fa-brands fa-docker',
    },
    'workspace.manage': {
      category: 'workspace',
      icon: 'fa-solid fa-cubes',
    },
    'browser.read': {
      category: 'browser',
      icon: 'fa-solid fa-globe',
    },
    'browser.interact': {
      category: 'browser',
      icon: 'fa-solid fa-arrow-pointer',
    },
    'integration.mcp.read': {
      category: 'integration',
      icon: 'fa-solid fa-book-open',
    },
    'integration.mcp.invoke': {
      category: 'integration',
      icon: 'fa-solid fa-network-wired',
    },
    'integration.acp.invoke': {
      category: 'integration',
      icon: 'fa-solid fa-satellite-dish',
    },
    'artifacts.read': {
      category: 'data',
      icon: 'fa-solid fa-box-archive',
    },
    'app.intents.exchange': {
      category: 'data',
      icon: 'fa-solid fa-right-left',
    },
  };

  const getCapabilityMeta = (cap: string): CapabilityMeta => {
    const meta = CAPABILITY_METAS[cap] ?? { category: 'data' as const, icon: 'fa-solid fa-key' };
    return {
      ...meta,
      name: CAPABILITY_METAS[cap] ? t(`agent.settings.apps.capabilities.${cap}.name`) : cap,
      desc: CAPABILITY_METAS[cap]
        ? t(`agent.settings.apps.capabilities.${cap}.desc`)
        : t('agent.settings.apps.capabilityUnknownDesc'),
    };
  };

  const categoryGroups = [
    { id: 'files', label: 'agent.settings.apps.categoryFiles', icon: 'fa-solid fa-folder-tree' },
    { id: 'execution', label: 'agent.settings.apps.categoryExecution', icon: 'fa-solid fa-terminal' },
    { id: 'machine', label: 'agent.settings.apps.categoryMachine', icon: 'fa-solid fa-server' },
    { id: 'workspace', label: 'agent.settings.apps.categoryWorkspace', icon: 'fa-solid fa-cubes' },
    { id: 'browser', label: 'agent.settings.apps.categoryBrowser', icon: 'fa-solid fa-globe' },
    { id: 'integration', label: 'agent.settings.apps.categoryIntegration', icon: 'fa-solid fa-plug' },
    { id: 'data', label: 'agent.settings.apps.categoryData', icon: 'fa-solid fa-box-archive' },
  ] as const;

  const appVisuals = (appId: string) => {
    if (appId === 'nexus.agent') {
      return {
        icon: 'fa-solid fa-wand-magic-sparkles',
        iconBg: 'bg-gradient-to-br from-primary/20 via-primary/15 to-transparent text-primary ring-1 ring-primary/25',
        badge: 'agent.settings.apps.coreOfficial',
        summary: 'agent.settings.apps.summaries.nexusAgent',
      };
    }
    if (appId === 'nexus.fullstack') {
      return {
        icon: 'fa-solid fa-layer-group',
        iconBg: 'bg-gradient-to-br from-success/20 via-success/15 to-transparent text-success ring-1 ring-success/25',
        badge: 'agent.settings.apps.badges.officialExtension',
        summary: 'agent.settings.apps.summaries.nexusFullstack',
      };
    }
    return {
      icon: 'fa-solid fa-puzzle-piece',
      iconBg: 'bg-primary/10 text-primary  ring-1 ring-primary/20',
      badge: 'agent.settings.apps.badges.thirdParty',
      summary: 'agent.settings.apps.summaries.default',
    };
  };

  const healthBadge = (health: string) => {
    if (health === 'healthy') {
      return {
        label: t('agent.settings.apps.healthHealthy'),
        dot: 'bg-success',
        badge: 'border-success/30 bg-success/10 text-success ',
      };
    }
    if (health === 'degraded') {
      return {
        label: t('agent.settings.apps.healthDegraded'),
        dot: 'bg-warning',
        badge: 'border-warning/30 bg-warning/10 text-warning ',
      };
    }
    return {
      label: t('agent.settings.apps.healthDisabled'),
      dot: 'bg-text-secondary/50',
      badge: 'border-border bg-header text-text-secondary',
    };
  };
</script>

<template>
  <section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
    <!-- 头部说明栏 -->
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-header/50 px-4 py-3.5 sm:px-5 sm:py-4"
    >
      <div class="flex items-center gap-2.5">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <i class="fa-solid fa-puzzle-piece text-sm" aria-hidden="true"></i>
        </div>
        <div class="flex items-center gap-1.5">
          <h3 class="text-sm font-bold text-foreground">{{ $t('agent.settings.apps.title') }}</h3>
          <UiInfoHint :text="$t('agent.settings.apps.description')" />
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-text-secondary shadow-2xs"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-success"></span>
          {{ $t('agent.settings.apps.enabledCount', { enabled: enabledCount, total: apps.length }) }}
        </span>
      </div>
    </div>

    <!-- 插件应用列表 -->
    <div class="space-y-4 p-4 sm:p-5">
      <div
        v-for="app in apps"
        :key="app.id"
        class="overflow-hidden rounded-2xl border transition-all duration-200"
        :class="
          app.enabled
            ? 'border-border bg-background shadow-xs hover:border-border-hover'
            : 'border-border/80 bg-header/30 opacity-85'
        "
      >
        <!-- 主卡片顶层信息栏 -->
        <div class="p-4 sm:p-5">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <!-- 左侧：图标 + 标题 + 徽章 + 描述 -->
            <div class="flex items-start gap-3.5 min-w-0">
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-xs"
                :class="appVisuals(app.id).iconBg"
              >
                <i :class="appVisuals(app.id).icon" class="text-xl" aria-hidden="true"></i>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-bold text-foreground tracking-tight">{{ app.displayName }}</span>
                  <span
                    class="rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-text-secondary"
                  >
                    v{{ app.version }}
                  </span>
                  <span class="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    {{ $t(appVisuals(app.id).badge) }}
                  </span>
                  <span
                    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                    :class="healthBadge(app.health).badge"
                  >
                    <span class="h-1.5 w-1.5 rounded-full" :class="healthBadge(app.health).dot"></span>
                    {{ healthBadge(app.health).label }}
                  </span>
                </div>

                <p class="mt-1 text-xs text-text-secondary line-clamp-1 leading-relaxed">
                  {{ $t(appVisuals(app.id).summary) }}
                </p>

                <!-- 微指标胶囊群 -->
                <div class="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    class="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-text-secondary shadow-2xs"
                  >
                    <i class="fa-solid fa-play text-[9px] text-text-secondary/70"></i>
                    {{ $t('agent.settings.apps.runsMetric') }}:
                    <strong class="font-mono text-foreground">{{ app.runningRuns }}</strong>
                  </span>
                  <span
                    class="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-text-secondary shadow-2xs"
                  >
                    <i class="fa-solid fa-shield text-[9px] text-text-secondary/70"></i>
                    {{ $t('agent.settings.apps.approvalsMetric') }}:
                    <strong class="font-mono text-foreground">{{ app.pendingApprovals }}</strong>
                  </span>
                  <span
                    v-if="grantViews[app.id]"
                    class="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-text-secondary shadow-2xs"
                  >
                    <i class="fa-solid fa-key text-[9px] text-primary"></i>
                    {{ $t('agent.settings.apps.grantsMetric') }}:
                    <strong class="font-mono text-foreground">
                      {{ grantViews[app.id].grants.length }}/{{ grantViews[app.id].capabilityDefinitions.length }}
                    </strong>
                  </span>
                </div>
              </div>
            </div>

            <!-- 右侧：状态切换开关与安全策略配置按钮 -->
            <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
              <UiButton
                appearance="soft"
                tone="neutral"
                type="button"
                @click="expandedGrants[app.id] = !expandedGrants[app.id]"
              >
                <i class="fa-solid fa-shield-halved text-xs text-primary" aria-hidden="true"></i>
                <span>{{ $t('agent.settings.apps.configPermissions') }}</span>
                <i
                  class="fa-solid fa-chevron-down text-[10px] transition-transform duration-200"
                  :class="{ 'rotate-180': expandedGrants[app.id] }"
                  aria-hidden="true"
                ></i>
              </UiButton>

              <UiButton
                type="button"
                :appearance="app.enabled ? 'soft' : 'solid'"
                :tone="app.enabled ? 'neutral' : 'primary'"
                :disabled="busy"
                @click="emit('toggle', app, !app.enabled)"
              >
                <span class="h-1.5 w-1.5 rounded-full" :class="app.enabled ? 'bg-success' : 'bg-white/70'"></span>
                <span>{{ app.enabled ? $t('agent.settings.apps.disable') : $t('agent.settings.apps.enable') }}</span>
              </UiButton>

              <!-- 只有停用的应用才能卸载 -->
              <!-- 停用状态：激活卸载按钮 -->
              <UiButton
                appearance="soft"
                tone="danger"
                v-if="!app.enabled && app.surface !== 'builtin'"
                type="button"
                :disabled="busy || uninstallBusy"
                :title="$t('agent.settings.apps.uninstall')"
                @click="requestUninstall(app)"
              >
                <i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
                <span>{{ $t('agent.settings.apps.uninstall') }}</span>
              </UiButton>

              <!-- 启用状态：禁用置灰按钮，引导先停用后卸载 -->
              <UiButton
                v-else
                type="button"
                appearance="soft"
                tone="neutral"
                :title="
                  app.surface === 'builtin'
                    ? $t('agent.settings.apps.coreAppCannotUninstall')
                    : $t('agent.settings.apps.uninstallDisabledHint')
                "
                disabled
              >
                <i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
                <span>{{ $t('agent.settings.apps.uninstall') }}</span>
              </UiButton>
            </div>
          </div>
        </div>

        <!-- 展开的能力授权矩阵抽屉 -->
        <div v-if="expandedGrants[app.id]" class="border-t border-border bg-header/20 p-4 sm:p-5 animate-fadeIn">
          <!-- 权限面板头部控制栏 -->
          <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
            <div>
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-foreground">{{
                  $t('agent.settings.apps.capabilitiesHeader')
                }}</span>
                <span class="text-[11px] text-text-secondary font-mono">
                  ({{ grantViews[app.id]?.grants.length ?? 0 }}/{{
                    grantViews[app.id]?.capabilityDefinitions.length ?? 0
                  }})
                </span>
              </div>
              <p class="text-[11px] text-text-secondary mt-0.5">
                {{ $t('agent.settings.apps.capabilitiesSubtitle') }}
              </p>
            </div>

            <div class="flex items-center gap-2">
              <UiButton
                v-if="grantViews[app.id]?.capabilityDefinitions.length"
                type="button"
                appearance="soft"
                tone="neutral"
                :aria-label="
                  capabilitySelectionState(app.id) === 'all'
                    ? $t('agent.settings.apps.disableAllCapabilities')
                    : $t('agent.settings.apps.enableAllCapabilities')
                "
                :disabled="busy || grantBusy[app.id]"
                @click="toggleAllCapabilities(app.id)"
              >
                <span
                  class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-current text-[9px]"
                  aria-hidden="true"
                >
                  <i v-if="capabilitySelectionState(app.id) === 'all'" class="fa-solid fa-check" aria-hidden="true"></i>
                  <i
                    v-else-if="capabilitySelectionState(app.id) === 'partial'"
                    class="fa-solid fa-minus"
                    aria-hidden="true"
                  ></i>
                </span>
                <span>
                  {{
                    capabilitySelectionState(app.id) === 'all'
                      ? $t('agent.settings.apps.disableCapabilities')
                      : $t('agent.settings.apps.enableCapabilities')
                  }}
                </span>
              </UiButton>
              <UiButton
                v-if="grantViews[app.id]"
                type="button"
                appearance="solid"
                tone="primary"
                :disabled="busy || grantBusy[app.id] || !grantChanged(app.id)"
                @click="saveGrants(app.id)"
              >
                <i v-if="grantBusy[app.id]" class="fa-solid fa-circle-notch fa-spin text-xs"></i>
                <i v-else class="fa-solid fa-check text-xs"></i>
                <span>
                  {{
                    grantBusy[app.id]
                      ? $t('agent.settings.apps.savingPermissions')
                      : $t('agent.settings.apps.savePermissions')
                  }}
                </span>
              </UiButton>
            </div>
          </div>

          <!-- 按资源边界分组的能力授权矩阵 -->
          <div v-if="grantViews[app.id]" class="mt-4 space-y-4">
            <div
              v-for="cat in categoryGroups"
              :key="cat.id"
              class="rounded-xl border border-border bg-card p-3.5 shadow-2xs"
            >
              <div class="flex items-center justify-between pb-2 mb-2.5 border-b border-border/60">
                <div class="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <i :class="cat.icon" class="text-primary text-[11px]" aria-hidden="true"></i>
                  <span>{{ $t(cat.label) }}</span>
                </div>
                <span class="font-mono text-[11px] text-text-secondary">
                  {{
                    $t('agent.settings.apps.grantedCount', {
                      granted: categoryCount(app.id, cat.id).checked,
                      total: categoryCount(app.id, cat.id).total,
                    })
                  }}
                </span>
              </div>

              <!-- 能力清单卡片网格 -->
              <div class="grid gap-2 sm:grid-cols-2">
                <div
                  v-for="capability in grantViews[app.id].capabilityDefinitions
                    .map((definition) => definition.id)
                    .filter((id) => getCapabilityMeta(id).category === cat.id)"
                  :key="capability"
                  class="group flex items-start gap-2.5 rounded-lg border p-2.5 transition-all select-none"
                  :class="
                    checked(app.id, capability)
                      ? 'border-primary/50 bg-primary/8 shadow-2xs ring-1 ring-primary/20'
                      : 'border-border bg-background hover:bg-header/50 hover:border-border-hover'
                  "
                >
                  <UiCheckbox
                    class="mt-0.5"
                    :model-value="checked(app.id, capability)"
                    :disabled="busy || grantBusy[app.id]"
                    @update:model-value="(value: boolean) => onCapabilityChange(app.id, capability, value)"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <i :class="getCapabilityMeta(capability).icon" class="text-[11px] text-text-secondary"></i>
                      <span class="text-xs font-semibold text-foreground">{{
                        getCapabilityMeta(capability).name
                      }}</span>
                    </div>
                    <p class="text-[11px] text-text-secondary leading-tight mt-0.5">
                      {{ getCapabilityMeta(capability).desc }}
                    </p>
                    <span class="mt-1 inline-block font-mono text-[11px] text-text-secondary/75">
                      {{ capability }}
                    </span>

                    <div
                      v-if="checked(app.id, capability) && definitionFor(app.id, capability)?.scopeKind === 'targets'"
                      class="mt-2 space-y-2 border-t border-border/60 pt-2"
                    >
                      <div
                        v-for="target in definitionFor(app.id, capability)?.supportedTargets ?? []"
                        :key="target"
                        class="rounded-md border border-border/70 bg-background/70 p-2"
                      >
                        <div class="flex items-center gap-2">
                          <UiCheckbox
                            density="compact"
                            :model-value="targetEnabled(app.id, capability, target)"
                            :disabled="busy || grantBusy[app.id]"
                            @update:model-value="
                              (value: boolean) => onTargetEnabledChange(app.id, capability, target, value)
                            "
                          />
                          <span class="text-[11px] font-semibold text-foreground">{{ targetLabel(target) }}</span>
                          <select
                            v-if="targetEnabled(app.id, capability, target)"
                            class="ml-auto rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground"
                            :value="targetScopeSelection(app.id, capability, target)?.mode"
                            :disabled="busy || grantBusy[app.id]"
                            @change="onTargetModeChange(app.id, capability, target, $event)"
                          >
                            <option value="all">All targets</option>
                            <option value="ids">Specific IDs</option>
                          </select>
                        </div>
                        <input
                          v-if="targetScopeSelection(app.id, capability, target)?.mode === 'ids'"
                          type="text"
                          class="mt-2 w-full rounded border border-border bg-card px-2 py-1 font-mono text-[11px] text-foreground"
                          :value="targetIdsValue(app.id, capability, target)"
                          placeholder="id-1, id-2"
                          :disabled="busy || grantBusy[app.id]"
                          @input="onTargetIdsInput(app.id, capability, target, $event)"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="!grantErrors[app.id]" class="py-4 text-center text-xs text-text-secondary">
            <i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-primary"></i>
            {{ $t('agent.settings.apps.permissionsLoading') }}
          </div>

          <p v-if="grantErrors[app.id]" class="mt-2 text-xs text-error">{{ grantErrors[app.id] }}</p>
        </div>
      </div>

      <div
        v-if="apps.length === 0"
        class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 p-8 text-center"
      >
        <i class="fa-solid fa-box-open text-2xl text-text-secondary/40 mb-2"></i>
        <p class="text-sm font-medium text-foreground">{{ $t('agent.settings.apps.empty') }}</p>
      </div>
    </div>
  </section>

  <!-- 卸载 Agent App 二次安全确认弹窗 -->
  <BaseModal
    :visible="uninstallModalOpen"
    :title="$t('agent.settings.apps.uninstallConfirmTitle')"
    :aria-label="$t('agent.settings.apps.uninstallConfirmTitle')"
    :close-on-backdrop="!uninstallBusy"
    :close-on-escape="!uninstallBusy"
    panel-class="max-w-md p-5 rounded-2xl shadow-2xl border border-border/80 bg-card"
    @close="uninstallModalOpen = false"
  >
    <div class="space-y-3.5">
      <div class="flex items-center gap-3 text-error">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-error/10 text-error">
          <i class="fa-solid fa-triangle-exclamation text-lg"></i>
        </div>
        <div>
          <div class="text-sm font-semibold text-foreground">{{ targetUninstallApp?.displayName }}</div>
          <div class="text-xs text-text-secondary font-mono">
            {{ targetUninstallApp?.id }} · v{{ targetUninstallApp?.version }}
          </div>
        </div>
      </div>

      <p class="text-xs text-text-secondary leading-relaxed">
        {{
          $t('agent.settings.apps.uninstallConfirmPrompt', {
            name: targetUninstallApp?.displayName,
            version: targetUninstallApp?.version,
          })
        }}
      </p>

      <label
        class="flex items-start gap-2 rounded-lg border border-border/70 bg-header/20 p-2.5 cursor-pointer select-none"
      >
        <UiCheckbox v-model="deleteDataOnUninstall" tone="danger" class="mt-0.5" />
        <span class="text-xs text-text-secondary leading-tight">
          {{ $t('agent.settings.apps.deleteDataOnUninstall') }}
        </span>
      </label>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UiButton
          appearance="soft"
          tone="neutral"
          type="button"
          :disabled="uninstallBusy"
          @click="uninstallModalOpen = false"
        >
          {{ $t('common.cancel') }}
        </UiButton>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg bg-error px-4 py-2 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-error/90 active:scale-95 disabled:opacity-50 cursor-pointer"
          :disabled="uninstallBusy"
          @click="confirmUninstall"
        >
          <i v-if="uninstallBusy" class="fa-solid fa-circle-notch fa-spin text-xs"></i>
          <i v-else class="fa-regular fa-trash-can text-xs"></i>
          <span>{{ $t('agent.settings.apps.uninstall') }}</span>
        </button>
      </div>
    </template>
  </BaseModal>
</template>
