<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseModal } from '@/foundation/ui';
  import { useOperationFeedback } from '@/shared/feedback/public';
  import {
    agentApi,
    formatAgentApiError,
    type AgentAppGrantView,
    type AgentAppSummary,
    type AgentCapabilityDefinition,
    type AgentCapabilityGrantInput,
    type AgentCapabilityScope,
    type AgentTargetGrantSelection,
    type AgentTargetKind,
  } from '../api/agent-api';

  const props = defineProps<{ apps: AgentAppSummary[]; busy: boolean }>();
  const emit = defineEmits<{
    toggle: [app: AgentAppSummary, enabled: boolean];
    grantsUpdated: [app: AgentAppSummary];
    refresh: [];
  }>();
  const { t } = useI18n();
  const operationFeedback = useOperationFeedback('agent.settings.apps');

  const grantViews = ref<Record<string, AgentAppGrantView>>({});
  const drafts = ref<Record<string, AgentCapabilityGrantInput[]>>({});
  const grantBusy = ref<Record<string, boolean>>({});
  const grantErrors = ref<Record<string, string>>({});
  const expandedGrants = ref<Record<string, boolean>>({});
  const grantLoadGeneration = new Map<string, number>();

  const explain = (cause: unknown): string => formatAgentApiError(cause, 'AGENT_REQUEST_FAILED');
  type CapabilityId = AgentCapabilityGrantInput['capability'];

  const cloneSelection = (selection: AgentTargetGrantSelection): AgentTargetGrantSelection =>
    selection.mode === 'all' ? { mode: 'all' } : { mode: 'ids', ids: [...selection.ids] };

  const cloneScope = (scope: AgentCapabilityScope): AgentCapabilityScope => {
    if (scope.kind === 'global') return { kind: 'global' };
    return {
      kind: 'targets',
      targets: Object.fromEntries(
        Object.entries(scope.targets).map(([target, selection]) => [
          target,
          cloneSelection(selection as AgentTargetGrantSelection),
        ]),
      ) as Partial<Record<AgentTargetKind, AgentTargetGrantSelection>>,
    };
  };

  const cloneGrant = (grant: AgentCapabilityGrantInput): AgentCapabilityGrantInput => ({
    capability: grant.capability,
    scope: cloneScope(grant.scope),
  });

  const definitionFor = (appId: string, capability: CapabilityId): AgentCapabilityDefinition | undefined =>
    grantViews.value[appId]?.capabilityDefinitions.find((definition) => definition.id === capability);

  const grantFor = (appId: string, capability: CapabilityId): AgentCapabilityGrantInput | undefined =>
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

  const canonicalGrants = (grants: readonly AgentCapabilityGrantInput[]): string =>
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

  const onCapabilityChange = (appId: string, capability: CapabilityId, event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    toggleCapability(appId, capability, target.checked);
  };

  const updateGrantScope = (
    appId: string,
    capability: CapabilityId,
    update: (scope: AgentCapabilityScope) => AgentCapabilityScope,
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
    target: AgentTargetKind,
  ): AgentTargetGrantSelection | undefined => {
    const scope = grantFor(appId, capability)?.scope;
    return scope?.kind === 'targets' ? scope.targets[target] : undefined;
  };

  const targetEnabled = (appId: string, capability: CapabilityId, target: AgentTargetKind): boolean =>
    targetScopeSelection(appId, capability, target) !== undefined;

  const targetLabel = (target: AgentTargetKind): string => (target === 'workspace' ? 'Workspace' : 'SSH');

  const setTargetEnabled = (appId: string, capability: CapabilityId, target: AgentTargetKind, enabled: boolean): void => {
    updateGrantScope(appId, capability, (scope) => {
      if (scope.kind !== 'targets') return scope;
      const targets = { ...scope.targets };
      if (enabled) targets[target] = { mode: 'all' };
      else delete targets[target];
      return { kind: 'targets', targets };
    });
  };

  const onTargetEnabledChange = (appId: string, capability: CapabilityId, target: AgentTargetKind, event: Event): void => {
    const input = event.target;
    if (input instanceof HTMLInputElement) setTargetEnabled(appId, capability, target, input.checked);
  };

  const setTargetMode = (
    appId: string,
    capability: CapabilityId,
    target: AgentTargetKind,
    mode: AgentTargetGrantSelection['mode'],
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

  const onTargetModeChange = (appId: string, capability: CapabilityId, target: AgentTargetKind, event: Event): void => {
    const input = event.target;
    if (input instanceof HTMLSelectElement && (input.value === 'all' || input.value === 'ids')) {
      setTargetMode(appId, capability, target, input.value);
    }
  };

  const targetIdsValue = (appId: string, capability: CapabilityId, target: AgentTargetKind): string => {
    const selection = targetScopeSelection(appId, capability, target);
    return selection?.mode === 'ids' ? selection.ids.join(', ') : '';
  };

  const onTargetIdsInput = (appId: string, capability: CapabilityId, target: AgentTargetKind, event: Event): void => {
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
  const targetUninstallApp = ref<AgentAppSummary | null>(null);
  const uninstallBusy = ref(false);
  const deleteDataOnUninstall = ref(false);

  const requestUninstall = (app: AgentAppSummary) => {
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
    name: string;
    desc: string;
    category: 'files' | 'execution' | 'machine' | 'workspace' | 'browser' | 'integration' | 'data';
    icon: string;
  }

  const CAPABILITY_METAS: Record<string, CapabilityMeta> = {
    'file.read': {
      name: '读取文件',
      desc: '读取与搜索已授权 Workspace 或 SSH 目标中的文件内容',
      category: 'files',
      icon: 'fa-solid fa-file-lines',
    },
    'file.write': {
      name: '写入文件',
      desc: '在已授权 Workspace 或 SSH 目标中创建、替换、移动或应用补丁',
      category: 'files',
      icon: 'fa-solid fa-file-pen',
    },
    'file.delete': {
      name: '删除文件',
      desc: '删除已授权 Workspace 或 SSH 目标中的文件或目录',
      category: 'files',
      icon: 'fa-solid fa-trash-can',
    },
    'machine.inspect': {
      name: '主机状态与连接信息',
      desc: '读取可用连接、系统负载与受控诊断信息',
      category: 'machine',
      icon: 'fa-solid fa-chart-line',
    },
    'shell.execute': {
      name: '执行命令',
      desc: '在已授权 Workspace 或 SSH 目标执行受策略与审批约束的命令',
      category: 'execution',
      icon: 'fa-solid fa-terminal',
    },
    'machine.docker.manage': {
      name: '管理 Docker 容器',
      desc: '启停、重启或移除授权目标上的容器',
      category: 'machine',
      icon: 'fa-brands fa-docker',
    },
    'workspace.manage': {
      name: '管理 Workspace 环境',
      desc: '创建、启停、删除环境并切换工具链版本',
      category: 'workspace',
      icon: 'fa-solid fa-cubes',
    },
    'browser.read': {
      name: '浏览器读取与导航',
      desc: '创建浏览会话、导航、快照、截图、控制台与下载读取',
      category: 'browser',
      icon: 'fa-solid fa-globe',
    },
    'browser.interact': {
      name: '浏览器页面交互',
      desc: '点击、输入、按键、选择与上传，可能改变远端页面状态',
      category: 'browser',
      icon: 'fa-solid fa-arrow-pointer',
    },
    'integration.mcp.read': {
      name: '读取 MCP 资源',
      desc: '发现并读取 MCP Resource、Prompt 与只读工具结果',
      category: 'integration',
      icon: 'fa-solid fa-book-open',
    },
    'integration.mcp.invoke': {
      name: '调用 MCP 动作',
      desc: '调用具有控制或修改效果的 MCP 工具',
      category: 'integration',
      icon: 'fa-solid fa-network-wired',
    },
    'integration.acp.invoke': {
      name: '调用 ACP Agent',
      desc: '通过 Agent Client Protocol 调用外部协作执行器',
      category: 'integration',
      icon: 'fa-solid fa-satellite-dish',
    },
    'artifacts.read': {
      name: '读取任务产物',
      desc: '读取当前 App 可访问的持久化产物',
      category: 'data',
      icon: 'fa-solid fa-box-archive',
    },
    'app.intents.exchange': {
      name: '跨 App 数据交换',
      desc: '通过声明的 App Intent 向其它 App 发送或接收数据',
      category: 'data',
      icon: 'fa-solid fa-right-left',
    },
  };

  const getCapabilityMeta = (cap: string): CapabilityMeta => {
    return (
      CAPABILITY_METAS[cap] ?? {
        name: cap,
        desc: '系统底层能力声明',
        category: 'data',
        icon: 'fa-solid fa-key',
      }
    );
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
        iconBg:
          'bg-gradient-to-br from-purple-500/20 via-primary/15 to-transparent text-primary ring-1 ring-primary/25',
        badge: 'agent.settings.apps.coreOfficial',
        summary: '官方通用智能体核心，内置自动化运维诊断与全栈工程协同技能',
      };
    }
    if (appId === 'nexus.fullstack') {
      return {
        icon: 'fa-solid fa-layer-group',
        iconBg:
          'bg-gradient-to-br from-emerald-500/20 via-teal-500/15 to-transparent text-emerald-500 ring-1 ring-emerald-500/25',
        badge: '官方扩展',
        summary: '全栈应用交付套件，支持微服务治理、复杂依赖联调与部署验证',
      };
    }
    return {
      icon: 'fa-solid fa-puzzle-piece',
      iconBg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-1 ring-primary/20',
      badge: '三方扩展',
      summary: '已安装并校验签名的 Agent 插件应用',
    };
  };

  const healthBadge = (health: string) => {
    if (health === 'healthy') {
      return {
        label: t('agent.settings.apps.healthHealthy'),
        dot: 'bg-emerald-500',
        badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      };
    }
    if (health === 'degraded') {
      return {
        label: t('agent.settings.apps.healthDegraded'),
        dot: 'bg-amber-500',
        badge: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
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
        <div>
          <h3 class="text-sm font-bold text-foreground">{{ $t('agent.settings.apps.title') }}</h3>
          <p class="text-xs text-text-secondary">{{ $t('agent.settings.apps.description') }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-text-secondary shadow-2xs"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
          已启用 {{ enabledCount }}/{{ apps.length }}
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
                  <span class="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {{ $t(appVisuals(app.id).badge) }}
                  </span>
                  <span
                    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                    :class="healthBadge(app.health).badge"
                  >
                    <span class="h-1.5 w-1.5 rounded-full" :class="healthBadge(app.health).dot"></span>
                    {{ healthBadge(app.health).label }}
                  </span>
                </div>

                <p class="mt-1 text-xs text-text-secondary line-clamp-1 leading-relaxed">
                  {{ appVisuals(app.id).summary }}
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
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-header hover:text-foreground transition-all cursor-pointer shadow-2xs"
                @click="expandedGrants[app.id] = !expandedGrants[app.id]"
              >
                <i class="fa-solid fa-shield-halved text-xs text-primary" aria-hidden="true"></i>
                <span>{{ $t('agent.settings.apps.configPermissions') }}</span>
                <i
                  class="fa-solid fa-chevron-down text-[10px] transition-transform duration-200"
                  :class="{ 'rotate-180': expandedGrants[app.id] }"
                  aria-hidden="true"
                ></i>
              </button>

              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold shadow-2xs transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                :class="
                  app.enabled
                    ? 'border border-border bg-card text-foreground hover:bg-header hover:border-border-hover'
                    : 'bg-primary text-white hover:bg-primary/90'
                "
                :disabled="busy"
                @click="emit('toggle', app, !app.enabled)"
              >
                <span class="h-1.5 w-1.5 rounded-full" :class="app.enabled ? 'bg-emerald-500' : 'bg-white/70'"></span>
                <span>{{ app.enabled ? $t('agent.settings.apps.disable') : $t('agent.settings.apps.enable') }}</span>
              </button>

              <!-- 只有停用的应用才能卸载 -->
              <!-- 停用状态：激活卸载按钮 -->
              <button
                v-if="!app.enabled && app.surface !== 'builtin'"
                type="button"
                class="inline-flex items-center gap-1 rounded-xl border border-error/30 bg-error/5 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/15 hover:border-error/50 transition-all cursor-pointer shadow-2xs active:scale-95 disabled:opacity-50"
                :disabled="busy || uninstallBusy"
                :title="$t('agent.settings.apps.uninstall')"
                @click="requestUninstall(app)"
              >
                <i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
                <span>{{ $t('agent.settings.apps.uninstall') }}</span>
              </button>

              <!-- 启用状态：禁用置灰按钮，引导先停用后卸载 -->
              <button
                v-else
                type="button"
                class="inline-flex items-center gap-1 rounded-xl border border-border/50 bg-header/30 px-3 py-1.5 text-xs font-medium text-text-secondary/40 cursor-not-allowed select-none transition-all"
                :title="
                  app.surface === 'builtin'
                    ? $t('agent.settings.apps.coreAppCannotUninstall')
                    : $t('agent.settings.apps.uninstallDisabledHint')
                "
                disabled
              >
                <i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
                <span>{{ $t('agent.settings.apps.uninstall') }}</span>
              </button>
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
              <button
                v-if="grantViews[app.id]?.capabilityDefinitions.length"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] shadow-2xs font-medium text-text-secondary hover:bg-header hover:text-foreground transition-all cursor-pointer"
                :aria-label="
                  capabilitySelectionState(app.id) === 'all'
                    ? $t('agent.settings.apps.disableAllCapabilities')
                    : $t('agent.settings.apps.enableAllCapabilities')
                "
                :disabled="busy || grantBusy[app.id]"
                @click="toggleAllCapabilities(app.id)"
              >
                <span
                  class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-current text-[8px]"
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
              </button>
              <button
                v-if="grantViews[app.id]"
                type="button"
                class="inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold text-white shadow-2xs transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                :class="grantChanged(app.id) ? 'bg-primary hover:bg-primary/90' : 'bg-primary/60 cursor-not-allowed'"
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
              </button>
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
                <span class="font-mono text-[10px] text-text-secondary">
                  {{ categoryCount(app.id, cat.id).checked }}/{{ categoryCount(app.id, cat.id).total }} 项已授权
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
                  <input
                    type="checkbox"
                    class="mt-0.5 h-4 w-4 rounded border-border text-primary accent-primary cursor-pointer"
                    :checked="checked(app.id, capability)"
                    :disabled="busy || grantBusy[app.id]"
                    @change="onCapabilityChange(app.id, capability, $event)"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <i :class="getCapabilityMeta(capability).icon" class="text-[10px] text-text-secondary"></i>
                      <span class="text-xs font-semibold text-foreground">{{
                        getCapabilityMeta(capability).name
                      }}</span>
                    </div>
                    <p class="text-[10px] text-text-secondary leading-tight mt-0.5">
                      {{ getCapabilityMeta(capability).desc }}
                    </p>
                    <span class="mt-1 inline-block font-mono text-[9px] text-text-secondary/60">
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
                          <input
                            type="checkbox"
                            class="h-3.5 w-3.5 rounded border-border accent-primary"
                            :checked="targetEnabled(app.id, capability, target)"
                            :disabled="busy || grantBusy[app.id]"
                            @change="onTargetEnabledChange(app.id, capability, target, $event)"
                          />
                          <span class="text-[10px] font-semibold text-foreground">{{ targetLabel(target) }}</span>
                          <select
                            v-if="targetEnabled(app.id, capability, target)"
                            class="ml-auto rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-foreground"
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
                          class="mt-2 w-full rounded border border-border bg-card px-2 py-1 font-mono text-[10px] text-foreground"
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
        <input v-model="deleteDataOnUninstall" type="checkbox" class="mt-0.5 rounded accent-error cursor-pointer" />
        <span class="text-xs text-text-secondary leading-tight"> 同时彻底删除此插件专属的独立持久化数据空间 </span>
      </label>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-border/80 bg-background px-3.5 py-1.8 text-xs font-medium text-text-secondary hover:bg-header hover:text-foreground transition-all cursor-pointer"
          :disabled="uninstallBusy"
          @click="uninstallModalOpen = false"
        >
          {{ $t('common.cancel') }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg bg-error px-4 py-1.8 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-error/90 active:scale-95 disabled:opacity-50 cursor-pointer"
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
