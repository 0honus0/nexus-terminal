<script setup lang="ts">
  import { UiButton } from '@/foundation/ui';
  import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import BaseModal from '@/foundation/ui/BaseModal.vue';
  import { useOperationFeedback } from '@/shared/feedback/public';
  import { agentHostEvents } from '../host/agent-host-events';
  import {
    agentApi,
    formatAgentApiError,
    type AgentAppSummaryDto,
    type AgentDiscoveredProviderModelDto,
    type AgentHardLimitsDto,
    type AgentProviderCreateRequestDto,
    type AgentProviderViewDto,
    type AgentSettingsViewDto,
    type AgentArtifactStorageSummaryDto,
    type AgentWorkspaceRuntimeAvailabilityDto,
    type AgentHardLimitPreviewDto,
    type AgentRecommendedPluginDto,
    type AgentTargetDenylistViewDto,
  } from '../api/agent-api';
  import AgentFeatureSettings from './AgentFeatureSettings.vue';
  import AcpRuntimeSettings from './AcpRuntimeSettings.vue';
  import AppManagementSettings from './AppManagementSettings.vue';
  import AppExecutionPolicySettings from './AppExecutionPolicySettings.vue';
  import BudgetContextSettings from './BudgetContextSettings.vue';
  import BrowserRuntimeSettings from './BrowserRuntimeSettings.vue';
  import McpIntegrationSettings from './McpIntegrationSettings.vue';
  import MemorySettings from './MemorySettings.vue';
  import WorkspaceRuntimeSettings from './WorkspaceRuntimeSettings.vue';
  import HardLimitsSettings from './HardLimitsSettings.vue';
  import ModelProviderSettings from './ModelProviderSettings.vue';
  import PerformanceSettings from './PerformanceSettings.vue';
  import PluginManagementSettings from './PluginManagementSettings.vue';
  import SafetyNetworkSettings from './SafetyNetworkSettings.vue';
  import StorageArtifactSettings from './StorageArtifactSettings.vue';
  import SubagentSettings from './SubagentSettings.vue';
  import SystemGuardrails from './SystemGuardrails.vue';

  const { t } = useI18n();
  const operationFeedback = useOperationFeedback('agent.settings');
  const settings = ref<AgentSettingsViewDto | null>(null);
  const apps = ref<AgentAppSummaryDto[]>([]);
  const providers = ref<AgentProviderViewDto[]>([]);
  const discoveredModels = ref<Record<string, AgentDiscoveredProviderModelDto[]>>({});
  const storage = ref<AgentArtifactStorageSummaryDto | null>(null);
  const workspaceRuntime = ref<AgentWorkspaceRuntimeAvailabilityDto | null>(null);
  const denylist = ref<AgentTargetDenylistViewDto | null>(null);
  const hardLimitPreview = ref<AgentHardLimitPreviewDto | null>(null);
  const loading = ref(true);
  type SettingsOperationLock = 'settings-write' | 'feature' | 'providers' | 'apps' | 'denylist';
  const activeOperationLocks = reactive(new Set<SettingsOperationLock>());
  const settingsMutationBusy = computed(() => activeOperationLocks.has('settings-write'));
  const featureOperationBusy = computed(() => activeOperationLocks.has('feature'));
  const featureControlBusy = computed(() => settingsMutationBusy.value || featureOperationBusy.value);
  const providerBusy = computed(() => activeOperationLocks.has('providers'));
  const appBusy = computed(() => activeOperationLocks.has('apps'));
  const appContextBusy = computed(() => appBusy.value || featureOperationBusy.value);
  const denylistBusy = computed(() => activeOperationLocks.has('denylist'));
  const runtimeIntegrationBusy = computed(() => settingsMutationBusy.value || appContextBusy.value);
  const loadError = ref('');
  const recommendedPlugin = ref<AgentRecommendedPluginDto | null>(null);
  const onboardingVisible = ref(false);
  const showKeyDetails = ref(false);
  const copiedKey = ref(false);
  const installStep = ref(1);
  const installProgress = ref(0);
  let installTimer: ReturnType<typeof setInterval> | null = null;

  const pluginDescription = computed(() => {
    if (recommendedPlugin.value?.appId === 'nexus.agent') {
      return t('agent.settings.onboarding.defaultPluginSummary');
    }
    return recommendedPlugin.value?.description || '';
  });

  const compactKeyId = (keyId: string): string => {
    if (!keyId) return '';
    if (keyId.length <= 24) return keyId;
    return `${keyId.slice(0, 16)}...${keyId.slice(-8)}`;
  };

  const copyKeyId = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey.value = true;
      setTimeout(() => {
        copiedKey.value = false;
      }, 1800);
    } catch (cause) {
      operationFeedback.notifyError({ operation: 'copy-publisher-key', message: message(cause), cause });
    }
  };

  const installingStepText = computed(() => {
    if (installStep.value === 1) return t('agent.settings.onboarding.installStep1');
    if (installStep.value === 2) return t('agent.settings.onboarding.installStep2');
    return t('agent.settings.onboarding.installStep3');
  });

  // 精简为 3 个高内聚大分类，彻底解决分类繁琐碎裂问题
  const groups = [
    { id: 'models', icon: 'fa-solid fa-brain', label: 'agent.settings.groups.models' },
    { id: 'runtime', icon: 'fa-solid fa-gauge-high', label: 'agent.settings.groups.runtime' },
    { id: 'plugins', icon: 'fa-solid fa-shield-halved', label: 'agent.settings.groups.plugins' },
  ] as const;

  type AgentSettingsGroupId = (typeof groups)[number]['id'];

  const activeGroup = ref<AgentSettingsGroupId>('models');
  const visitedGroups = reactive(new Set<AgentSettingsGroupId>(['models']));

  // 「一个分组下到底有哪些设置」的地图：宽屏左栏用它做跳转与滚动联动。
  // 标签直接复用各模块自己的标题 key，避免同义文案两处维护。
  const sectionGroups: Record<AgentSettingsGroupId, { id: string; label: string; icon: string }[]> = {
    models: [
      { id: 'feature', label: 'agent.settings.feature.title', icon: 'fa-solid fa-toggle-on' },
      { id: 'providers', label: 'agent.settings.providers.title', icon: 'fa-solid fa-server' },
      { id: 'budget', label: 'agent.settings.budget.title', icon: 'fa-solid fa-coins' },
      { id: 'hardLimits', label: 'agent.settings.hardLimits.title', icon: 'fa-solid fa-lock' },
    ],
    runtime: [
      { id: 'performance', label: 'agent.settings.performance.title', icon: 'fa-solid fa-bolt' },
      { id: 'executionPolicy', label: 'agent.settings.executionPolicy.title', icon: 'fa-solid fa-sliders' },
      { id: 'workspace', label: 'agent.settings.workspaceRuntime.title', icon: 'fa-solid fa-cube' },
      { id: 'browser', label: 'agent.settings.browserRuntime.title', icon: 'fa-solid fa-globe' },
      { id: 'mcp', label: 'agent.settings.mcpIntegrations.title', icon: 'fa-solid fa-plug' },
      { id: 'acp', label: 'agent.settings.acpRuntime.title', icon: 'fa-solid fa-terminal' },
      { id: 'subagents', label: 'agent.settings.subagents.title', icon: 'fa-solid fa-diagram-project' },
      { id: 'storage', label: 'agent.settings.storage.title', icon: 'fa-solid fa-database' },
    ],
    plugins: [
      { id: 'apps', label: 'agent.settings.apps.title', icon: 'fa-solid fa-puzzle-piece' },
      { id: 'memory', label: 'agent.settings.memory.title', icon: 'fa-solid fa-brain' },
      { id: 'plugins', label: 'agent.settings.plugins.title', icon: 'fa-solid fa-store' },
      { id: 'safety', label: 'agent.settings.safety.title', icon: 'fa-solid fa-ban' },
      { id: 'guardrails', label: 'agent.settings.guardrails.title', icon: 'fa-solid fa-shield-halved' },
    ],
  };

  const sectionAnchor = (id: string): string => 'agent-settings-sec-' + id;

  // 页面用 window 滚动，顶栏 h-14 sticky 占位，滚动联动以它为基准线。
  const STICKY_OFFSET = 56 + 14;
  const activeSection = ref(sectionGroups.models[0].id);
  let scrollFrame = 0;
  let anchorToken = 0;
  let anchorTimer = 0;

  const syncActiveSection = (): void => {
    const sections = sectionGroups[activeGroup.value] ?? [];
    if (sections.length === 0) return;
    let current = sections[0].id;
    // 最后一个分区永远够不到顶（页面滚到底即被夹住），此时直接认它。
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom) {
      activeSection.value = sections[sections.length - 1].id;
      return;
    }
    for (const section of sections) {
      const element = document.getElementById(sectionAnchor(section.id));
      if (!element) continue;
      if (element.getBoundingClientRect().top <= STICKY_OFFSET + 8) current = section.id;
    }
    activeSection.value = current;
  };

  const onViewportChange = (): void => {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0;
      syncActiveSection();
    });
  };

  /**
   * 刚切分组时模块还没渲染完，文档高度还在长（实测 2760 → 3370 → 3394）。
   * 此时按当前布局算出的落点是错的，跳过去之后内容再撑高就变成了「跳两次」。
   * 等连续两帧高度不变再量、再跳。
   */
  const waitForStableLayout = (): Promise<void> =>
    new Promise((resolve) => {
      const started = performance.now();
      let previous = -1;
      let stableFrames = 0;
      const step = (): void => {
        const height = document.documentElement.scrollHeight;
        stableFrames = height === previous ? stableFrames + 1 : 0;
        previous = height;
        const elapsed = performance.now() - started;
        // 高度稳定只是必要条件：异步内容（模型 / 集成列表）常在 100ms 后才到，
        // 所以再压一个最短观察窗口，避免刚量完就又被撑开。
        if ((stableFrames >= 2 && elapsed >= 140) || elapsed >= 600) {
          resolve();
          return;
        }
        window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    });

  /**
   * 落点仍然偏了就再校一次（迟到的异步内容会把目标推开），收敛到 4px 以内即停；
   * 用户自己一动滚轮 / 键盘就立刻放弃，不抢滚动权。
   */
  const settleAnchor = (sectionId: string, token: number, attempt = 8): void => {
    if (token !== anchorToken) return;
    const element = document.getElementById(sectionAnchor(sectionId));
    if (!element) return;
    const delta = element.getBoundingClientRect().top - STICKY_OFFSET;
    // 只补看得出来的偏差；几个像素的迟到位移不再折腾第二次跳转。
    if (Math.abs(delta) < 24 || attempt === 0) {
      syncActiveSection();
      return;
    }
    window.scrollBy({ top: delta, behavior: 'smooth' });
    anchorTimer = window.setTimeout(() => settleAnchor(sectionId, token, attempt - 1), 220);
  };

  const cancelAnchorSettle = (): void => {
    anchorToken += 1;
    if (anchorTimer) {
      window.clearTimeout(anchorTimer);
      anchorTimer = 0;
    }
  };

  const gotoSection = async (groupId: AgentSettingsGroupId, sectionId: string): Promise<void> => {
    cancelAnchorSettle();
    const token = anchorToken;
    if (activeGroup.value !== groupId) {
      activeGroup.value = groupId;
      visitedGroups.add(groupId);
      loadError.value = '';
      await nextTick();
      await waitForStableLayout();
      if (token !== anchorToken) return;
    }
    activeSection.value = sectionId;
    const element = document.getElementById(sectionAnchor(sectionId));
    if (!element) return;
    window.scrollBy({ top: element.getBoundingClientRect().top - STICKY_OFFSET, behavior: 'smooth' });
    // 集成 / 运行时列表是异步到的，晚到的内容会把目标推开，所以看得久一点。
    anchorTimer = window.setTimeout(() => settleAnchor(sectionId, token, 8), 220);
  };

  const enabledApps = computed(() => apps.value.filter((app) => app.enabled).length);
  const defaultModelName = computed(() => {
    if (!settings.value?.requestedSettings.model.defaultModelId) return t('agent.settings.modelNotSet');
    return settings.value.requestedSettings.model.defaultModelId;
  });

  const message = (cause: unknown): string => formatAgentApiError(cause, t('agent.operations.requestFailed'));

  const load = async () => {
    loading.value = true;
    loadError.value = '';
    try {
      const [nextSettings, nextApps, nextProviders, nextStorage, nextWorkspaceRuntime, nextDenylist] =
        await Promise.all([
          agentApi.settings(),
          agentApi.apps(),
          agentApi.providers(),
          agentApi.storage(),
          agentApi.workspaceRuntimeAvailability(),
          agentApi.targetDenylist(),
        ]);
      settings.value = nextSettings;
      apps.value = nextApps;
      providers.value = nextProviders;
      storage.value = nextStorage;
      workspaceRuntime.value = nextWorkspaceRuntime;
      denylist.value = nextDenylist;
    } catch (cause) {
      loadError.value = message(cause);
      operationFeedback.notifyError({ operation: 'load-settings', message: loadError.value, cause });
    } finally {
      loading.value = false;
      void nextTick(syncActiveSection);
    }
  };

  const execute = async <T = void,>(
    operation: string,
    locks: readonly SettingsOperationLock[],
    action: () => Promise<T>,
    success?: string | null,
  ): Promise<T | undefined> => {
    if (locks.some((lock) => activeOperationLocks.has(lock))) {
      const cause = new Error('AGENT_SETTINGS_OPERATION_BUSY');
      operationFeedback.notifyError({
        operation,
        message: t('agent.ui.operationInProgress'),
        cause,
      });
      return undefined;
    }
    for (const lock of locks) activeOperationLocks.add(lock);
    try {
      const result = await action();
      // Provider list changed (model added/removed/enabled): let the open Agent surface reload.
      if (locks.includes('providers')) agentHostEvents.emit('configuration-changed', undefined);
      if (success !== null) operationFeedback.notifySuccess(success ?? t('agent.ui.saved'));
      return result;
    } catch (cause) {
      operationFeedback.notifyError({ operation, message: message(cause), cause });
      return undefined;
    } finally {
      for (const lock of locks) activeOperationLocks.delete(lock);
    }
  };

  const patchSection = (section: string, patch: Record<string, unknown>, success?: string) =>
    execute(
      `patch-${section}`,
      ['settings-write'],
      async () => {
        if (!settings.value) return;
        settings.value = await agentApi.patchSettings({ [section]: patch }, settings.value.revision);
        storage.value = await agentApi.storage();
        agentHostEvents.emit('host-changed', undefined);
        agentHostEvents.emit('configuration-changed', undefined);
      },
      success,
    );

  const runtimeReady = (state: AgentSettingsViewDto['availability']['state']): boolean =>
    state === 'enabled' || state === 'degraded';

  const assertAppReady = (app: AgentAppSummaryDto): void => {
    if (app.enabled && (app.health === 'healthy' || app.health === 'degraded')) return;
    throw new Error(app.healthReason || t('agent.settings.feature.enableFailed'));
  };

  const assertFeatureReady = (view: AgentSettingsViewDto): void => {
    if (runtimeReady(view.availability.state)) return;
    throw new Error(view.availability.reason || t('agent.settings.feature.enableFailed'));
  };

  const changeFeature = (enabled: boolean): void => {
    if (!enabled) {
      void execute(
        'disable-feature',
        ['feature', 'settings-write'],
        async () => {
          if (!settings.value) return;
          const updated = await agentApi.patchSettings({ feature: { enabled: false } }, settings.value.revision);
          if (updated.availability.state !== 'disabled') throw new Error(t('agent.settings.feature.disableFailed'));
          settings.value = updated;
          storage.value = await agentApi.storage();
          agentHostEvents.emit('host-changed', undefined);
        },
        t('agent.settings.feature.disabledSuccess'),
      );
      return;
    }
    void execute(
      'enable-feature',
      ['feature', 'settings-write', 'apps'],
      async () => {
        if (!settings.value) return;
        const recommendation = await agentApi.recommendedPlugin();
        if (recommendation.installed) {
          if (!recommendation.enabled) {
            const installed = await agentApi.installRecommendedPlugin();
            assertAppReady(installed.app);
            apps.value = await agentApi.apps();
          }
          const updated = await agentApi.patchSettings({ feature: { enabled: true } }, settings.value.revision);
          settings.value = updated;
          assertFeatureReady(updated);
          storage.value = await agentApi.storage();
          agentHostEvents.emit('host-changed', undefined);
          operationFeedback.notifySuccess(t('agent.settings.feature.enabledSuccess'));
          return;
        }
        recommendedPlugin.value = recommendation;
        onboardingVisible.value = true;
      },
      null,
    );
  };

  const confirmRecommendedInstall = (): void => {
    installStep.value = 1;
    installProgress.value = 25;
    if (installTimer) clearInterval(installTimer);
    installTimer = setInterval(() => {
      if (installStep.value === 1) {
        installStep.value = 2;
        installProgress.value = 65;
      } else if (installStep.value === 2) {
        installStep.value = 3;
        installProgress.value = 90;
      }
    }, 450);

    void execute('install-recommended-plugin', ['feature', 'settings-write', 'apps'], async () => {
      if (!settings.value) return;
      try {
        const installed = await agentApi.installRecommendedPlugin();
        assertAppReady(installed.app);
        installProgress.value = 100;
        const updated = await agentApi.patchSettings({ feature: { enabled: true } }, settings.value.revision);
        settings.value = updated;
        assertFeatureReady(updated);
        storage.value = await agentApi.storage();
        apps.value = await agentApi.apps();
        agentHostEvents.emit('host-changed', undefined);
        operationFeedback.notifySuccess(t('agent.settings.feature.enabledSuccess'));
        setTimeout(() => {
          onboardingVisible.value = false;
          recommendedPlugin.value = null;
          showKeyDetails.value = false;
          if (installTimer) clearInterval(installTimer);
        }, 350);
      } catch (err) {
        if (installTimer) clearInterval(installTimer);
        throw err;
      }
    });
  };

  const closeOnboarding = (): void => {
    if (featureOperationBusy.value) return;
    if (installTimer) clearInterval(installTimer);
    onboardingVisible.value = false;
    recommendedPlugin.value = null;
    showKeyDetails.value = false;
  };

  const toggleApp = (app: AgentAppSummaryDto, enabled: boolean) =>
    execute('toggle-app', ['apps'], async () => {
      const updated = await agentApi.setAppEnabled(app, enabled);
      apps.value = apps.value.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    });

  const previewHardLimits = (proposed: Partial<AgentHardLimitsDto>) =>
    execute(
      'preview-hard-limits',
      ['settings-write'],
      async () => {
        if (!settings.value) return;
        hardLimitPreview.value = await agentApi.previewHardLimits(proposed, settings.value.revision);
      },
      null,
    );

  const confirmHardLimits = (confirmationId: string, expectedVersion: number) =>
    execute('confirm-hard-limits', ['settings-write'], async () => {
      settings.value = await agentApi.confirmHardLimits(confirmationId, expectedVersion);
      hardLimitPreview.value = null;
      storage.value = await agentApi.storage();
    });

  const createProvider = (input: AgentProviderCreateRequestDto, successMsg?: string) =>
    execute(
      'create-provider',
      ['providers'],
      async () => {
        const created = await agentApi.createProvider(input);
        providers.value = await agentApi.providers();
        apps.value = await agentApi.apps();
        return created;
      },
      successMsg,
    );

  const toggleProvider = (provider: AgentProviderViewDto, enabled: boolean) =>
    execute('toggle-provider', ['providers'], async () => {
      const updated = await agentApi.updateProvider(provider, { enabled });
      providers.value = providers.value.map((candidate) => (candidate.id === updated.id ? updated : candidate));
      apps.value = await agentApi.apps();
    });

  const changeProviderProtocol = (provider: AgentProviderViewDto, protocol: AgentProviderViewDto['protocol']) =>
    execute('change-provider-protocol', ['providers'], async () => {
      const previous = provider;
      providers.value = providers.value.map((candidate) =>
        candidate.id === provider.id ? { ...candidate, protocol } : candidate,
      );
      try {
        const updated = await agentApi.updateProvider(provider, { protocol });
        providers.value = providers.value.map((candidate) => (candidate.id === updated.id ? updated : candidate));
      } catch (cause) {
        providers.value = providers.value.map((candidate) => (candidate.id === previous.id ? previous : candidate));
        throw cause;
      }
    });

  const deleteProvider = (provider: AgentProviderViewDto) =>
    execute('delete-provider', ['providers', 'settings-write'], async () => {
      await agentApi.deleteProvider(provider.id, provider.version);
      providers.value = await agentApi.providers();
      if (settings.value) {
        const currentModel = settings.value.requestedSettings.model;
        const modelPatch: Record<string, unknown> = {};
        const nextFallbackModels = currentModel.fallbackModels.filter(
          (fallback) => fallback.providerId !== provider.id,
        );
        if (nextFallbackModels.length !== currentModel.fallbackModels.length) {
          modelPatch.fallbackModels = nextFallbackModels;
        }
        if (currentModel.defaultProviderId === provider.id) {
          const fallbackProvider =
            providers.value.find((candidate) => candidate.enabled && candidate.models.length > 0) ??
            providers.value.find((candidate) => candidate.models.length > 0) ??
            null;
          modelPatch.defaultProviderId = fallbackProvider?.id ?? null;
          modelPatch.defaultModelId = fallbackProvider?.models[0]?.id ?? null;
        }
        if (Object.keys(modelPatch).length > 0) {
          settings.value = await agentApi.patchSettings({ model: modelPatch }, settings.value.revision);
        }
      }
      apps.value = await agentApi.apps();
      return true;
    });

  const setDefaultModel = (providerId: string, modelId: string) =>
    patchSection(
      'model',
      { defaultProviderId: providerId, defaultModelId: modelId },
      t('agent.settings.providers.saveNoticeDefault'),
    );

  const setFallbackModels = (fallbackModels: Array<{ providerId: string; modelId: string }>) =>
    patchSection('model', { fallbackModels }, t('agent.settings.providers.saveNoticeFallback'));

  const discoverProviderModels = (provider: AgentProviderViewDto) =>
    execute(
      'discover-provider-models',
      ['providers'],
      async () => {
        discoveredModels.value = {
          ...discoveredModels.value,
          [provider.id]: await agentApi.discoverProviderModels(provider.id),
        };
        providers.value = await agentApi.providers();
      },
      null,
    );

  const addProviderModel = (
    provider: AgentProviderViewDto,
    model: AgentProviderViewDto['models'][number],
    successMsg?: string,
  ) =>
    execute(
      'add-provider-model',
      ['providers'],
      async () => {
        if (provider.models.some((candidate) => candidate.id === model.id)) return;
        const updated = await agentApi.updateProvider(provider, { models: [...provider.models, model] });
        providers.value = providers.value.map((candidate) => (candidate.id === updated.id ? updated : candidate));
        return true;
      },
      successMsg ?? t('agent.settings.providers.saveNoticeAdded', { count: 1 }),
    );

  const updateProviderModels = (
    provider: AgentProviderViewDto,
    models: AgentProviderViewDto['models'],
    successMsg?: string,
  ) =>
    execute(
      'update-provider-models',
      ['providers'],
      async () => {
        if (!models.length) return false;
        const updated = await agentApi.updateProvider(provider, { models });
        providers.value = providers.value.map((candidate) => (candidate.id === updated.id ? updated : candidate));
        return true;
      },
      successMsg,
    );

  const saveDenylist = (connectionIds: number[], reason: string) =>
    execute('save-target-denylist', ['denylist'], async () => {
      if (!denylist.value) return;
      denylist.value = await agentApi.replaceTargetDenylist(connectionIds, reason, denylist.value.revision);
      agentHostEvents.emit('authorization-changed', { revision: denylist.value.revision, connectionIds });
      agentHostEvents.emit('host-changed', undefined);
    });

  const selectGroup = (id: AgentSettingsGroupId): void => {
    if (activeGroup.value === id) return;
    activeGroup.value = id;
    visitedGroups.add(id);
    loadError.value = '';
    void nextTick(syncActiveSection);
  };

  onMounted(() => {
    void load();
    window.addEventListener('scroll', onViewportChange, { passive: true });
    window.addEventListener('resize', onViewportChange, { passive: true });
    window.addEventListener('wheel', cancelAnchorSettle, { passive: true });
    window.addEventListener('touchstart', cancelAnchorSettle, { passive: true });
    window.addEventListener('keydown', cancelAnchorSettle);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onViewportChange);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('wheel', cancelAnchorSettle);
    window.removeEventListener('touchstart', cancelAnchorSettle);
    window.removeEventListener('keydown', cancelAnchorSettle);
    cancelAnchorSettle();
    if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
  });
</script>

<template>
  <!-- 单根节点：BaseModal 只是 teleport 门户，但两个根会让父级 v-show 落到非元素根上而失效（切 Tab 后本块仍留在页面下方），包一层无样式 div。 -->
  <div>
    <section
      id="settings-panel-agent"
      class="rounded-xl border border-border bg-background shadow-sm"
      aria-labelledby="settings-agent-title"
    >
      <!-- 主卡片头部：包含全局概览微状态 -->
      <header class="rounded-t-xl border-b border-border bg-header/40 px-5 py-4 sm:px-6">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div class="flex items-center gap-2.5">
              <h2 id="settings-agent-title" class="text-base font-semibold text-foreground">
                {{ $t('agent.settings.title') }}
              </h2>
              <span
                v-if="settings"
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                :class="
                  runtimeReady(settings.availability.state)
                    ? 'bg-success/15 text-success'
                    : 'bg-text-secondary/15 text-text-secondary'
                "
              >
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  :class="runtimeReady(settings.availability.state) ? 'bg-success' : 'bg-text-secondary'"
                ></span>
                {{
                  runtimeReady(settings.availability.state)
                    ? $t('agent.settings.enabled')
                    : $t('agent.settings.disabled')
                }}
              </span>
            </div>
            <p class="mt-1 text-xs text-text-secondary">
              {{ $t('agent.settings.description') }}
            </p>
          </div>

          <!-- 关键指标快照：无需额外概览 Tab，直接在此处呈现关键摘要 -->
          <dl v-if="settings" class="agent-settings-summary">
            <div class="agent-settings-summary__item">
              <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
              <div>
                <dt>{{ $t('agent.settings.summary.defaultModel') }}</dt>
                <dd class="agent-settings-summary__value" :title="defaultModelName">
                  {{ defaultModelName }}
                </dd>
              </div>
            </div>
            <div class="agent-settings-summary__item">
              <i class="fa-solid fa-puzzle-piece" aria-hidden="true"></i>
              <div>
                <dt>{{ $t('agent.settings.summary.activeApps') }}</dt>
                <dd class="agent-settings-summary__value">{{ enabledApps }}/{{ apps.length }}</dd>
              </div>
            </div>
            <div class="agent-settings-summary__item">
              <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
              <div>
                <dt>{{ $t('agent.settings.summary.sandbox') }}</dt>
                <dd class="agent-settings-summary__value" :class="workspaceRuntime?.available ? 'is-ready' : undefined">
                  {{
                    workspaceRuntime?.available
                      ? $t('agent.settings.summary.ready')
                      : $t('agent.settings.summary.notReady')
                  }}
                </dd>
              </div>
            </div>
          </dl>
        </div>
      </header>

      <div v-if="loading" class="p-10 text-center text-sm text-text-secondary">
        {{ $t('agent.settings.loading') }}
      </div>

      <p v-else-if="!settings && loadError" role="alert" class="p-6 text-sm text-error">{{ loadError }}</p>

      <template v-else-if="settings && storage && workspaceRuntime && denylist">
        <div class="agent-settings-shell">
          <!-- 宽屏常驻分区导航：左栏是「这个分组里有哪些设置」的地图，右侧只滚动一个分组。 -->
          <div class="agent-settings-rail">
            <nav class="agent-settings-rail-nav" :aria-label="$t('agent.settings.navigation')">
              <template v-for="group in groups" :key="group.id">
                <button
                  type="button"
                  class="agent-settings-rail-heading"
                  :class="activeGroup === group.id ? 'is-active' : undefined"
                  :aria-current="activeGroup === group.id ? 'true' : undefined"
                  @click="selectGroup(group.id)"
                >
                  <i :class="group.icon" aria-hidden="true"></i>
                  <span>{{ $t(group.label) }}</span>
                </button>
                <ul class="agent-settings-rail-list">
                  <li v-for="section in sectionGroups[group.id]" :key="section.id">
                    <button
                      type="button"
                      class="agent-settings-rail-item"
                      :class="activeGroup === group.id && activeSection === section.id ? 'is-active' : undefined"
                      :aria-current="activeGroup === group.id && activeSection === section.id ? 'true' : undefined"
                      @click="gotoSection(group.id, section.id)"
                    >
                      <i :class="section.icon" aria-hidden="true"></i>
                      <span>{{ $t(section.label) }}</span>
                    </button>
                  </li>
                </ul>
              </template>
            </nav>
          </div>

          <div class="agent-settings-main">
            <!-- 窄屏 3 大核心分类胶囊导航（宽屏由左栏接管） -->
            <nav
              class="agent-settings-pills sticky top-14 z-20 flex shrink-0 flex-wrap justify-center gap-2 border-b border-border/60 bg-header p-2.5 sm:px-6"
              :aria-label="$t('agent.settings.navigation')"
            >
              <button
                v-for="group in groups"
                :key="group.id"
                type="button"
                class="inline-flex min-h-8 items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-medium transition-all focus-visible:outline-2 focus-visible:outline-primary"
                :class="
                  activeGroup === group.id
                    ? 'bg-primary text-white shadow-xs font-semibold'
                    : 'text-text-secondary hover:bg-header hover:text-foreground'
                "
                :aria-current="activeGroup === group.id ? 'page' : undefined"
                :aria-controls="`agent-settings-${group.id}`"
                @click="selectGroup(group.id)"
              >
                <i :class="group.icon" class="text-xs" aria-hidden="true"></i>
                <span>{{ $t(group.label) }}</span>
              </button>
            </nav>

            <!-- 分区内容流：自然流动排版，无局部高度截断与双层滚动条 -->
            <div class="agent-settings-flow p-4 sm:p-6">
              <!-- 1. 模型与预算（核心大本营） -->
              <section
                v-if="visitedGroups.has('models')"
                v-show="activeGroup === 'models'"
                id="agent-settings-models"
                class="agent-settings-group"
              >
                <!-- Agent 功能开关 -->
                <div :id="sectionAnchor('feature')" class="agent-settings-item">
                  <AgentFeatureSettings :settings="settings" :busy="featureControlBusy" @change="changeFeature" />
                </div>

                <!-- 模型服务商与默认模型 -->
                <div :id="sectionAnchor('providers')" class="agent-settings-item">
                  <ModelProviderSettings
                    :providers="providers"
                    :busy="providerBusy"
                    :discoveries="discoveredModels"
                    :default-provider-id="settings.requestedSettings.model.defaultProviderId"
                    :default-model-id="settings.requestedSettings.model.defaultModelId"
                    :fallback-models="settings.requestedSettings.model.fallbackModels"
                    :create-provider="createProvider"
                    @toggle="toggleProvider"
                    @protocol="changeProviderProtocol"
                    @discover="discoverProviderModels"
                    :add-provider-model="addProviderModel"
                    :update-provider-models="updateProviderModels"
                    @default-model="setDefaultModel"
                    @fallback-models="setFallbackModels"
                    @delete="deleteProvider"
                  />
                </div>

                <!-- 预算预设与参数控制 -->
                <div :id="sectionAnchor('budget')" class="agent-settings-item">
                  <BudgetContextSettings
                    :settings="settings"
                    :busy="settingsMutationBusy"
                    @save="(patch) => patchSection('budget', patch)"
                  />
                </div>

                <!-- 高级实例硬限制策略：收拢为优雅的可折叠高级面板，避免喧宾夺主 -->
                <div :id="sectionAnchor('hardLimits')" class="agent-settings-item">
                  <details class="group overflow-hidden rounded-xl border border-border/70 bg-card/25 transition-all">
                    <summary
                      class="flex cursor-pointer list-none items-center justify-between gap-3 bg-header/30 px-4 py-3 select-none hover:bg-header/50 sm:px-5 sm:py-3.5"
                    >
                      <div class="flex items-center gap-2.5">
                        <i class="fa-solid fa-shield text-xs text-text-secondary" aria-hidden="true"></i>
                        <div>
                          <span class="text-sm font-semibold text-foreground">{{
                            $t('agent.settings.hardLimits.panelTitle')
                          }}</span>
                          <span class="ml-2 text-xs text-text-secondary">{{
                            $t('agent.settings.hardLimits.panelHint')
                          }}</span>
                        </div>
                      </div>
                      <i
                        class="fa-solid fa-chevron-down text-xs text-text-secondary transition-transform group-open:rotate-180"
                        aria-hidden="true"
                      ></i>
                    </summary>
                    <div class="border-t border-border/60 p-1">
                      <HardLimitsSettings
                        :settings="settings"
                        :preview="hardLimitPreview"
                        :busy="settingsMutationBusy"
                        @preview="previewHardLimits"
                        @confirm="confirmHardLimits"
                        @dismiss="hardLimitPreview = null"
                      />
                    </div>
                  </details>
                </div>
              </section>

              <!-- 2. 运行与环境（并发、沙箱容器与存储空间） -->
              <section
                v-if="visitedGroups.has('runtime')"
                v-show="activeGroup === 'runtime'"
                id="agent-settings-runtime"
                class="agent-settings-group"
              >
                <!-- 并发与性能 -->
                <div :id="sectionAnchor('performance')" class="agent-settings-item">
                  <PerformanceSettings
                    :settings="settings"
                    :busy="settingsMutationBusy"
                    @save="(patch) => patchSection('performance', patch)"
                  />
                </div>

                <!-- 每个 Agent Plugin/App 独立执行预算；未覆盖字段继承全局默认 -->
                <div :id="sectionAnchor('executionPolicy')" class="agent-settings-item">
                  <AppExecutionPolicySettings :apps="apps" :busy="appContextBusy" />
                </div>

                <!-- Workspace 开发环境运行时 -->
                <div :id="sectionAnchor('workspace')" class="agent-settings-item">
                  <WorkspaceRuntimeSettings
                    :availability="workspaceRuntime"
                    :settings="settings"
                    :busy="settingsMutationBusy"
                    @settings-updated="(updated) => (settings = updated)"
                  />
                </div>

                <!-- 浏览器 CDP 运行时与 ACP 协议 -->
                <div :id="sectionAnchor('browser')" class="agent-settings-item">
                  <BrowserRuntimeSettings
                    :settings="settings"
                    :busy="settingsMutationBusy"
                    @save="(patch) => patchSection('browser', patch)"
                  />
                </div>

                <div :id="sectionAnchor('mcp')" class="agent-settings-item">
                  <McpIntegrationSettings
                    :busy="appContextBusy"
                    :agent-available="apps.some((app) => app.id === 'nexus.agent')"
                  />
                </div>

                <div :id="sectionAnchor('acp')" class="agent-settings-item">
                  <AcpRuntimeSettings
                    :settings="settings"
                    :busy="runtimeIntegrationBusy"
                    :agent-available="apps.some((app) => app.id === 'nexus.agent')"
                    @save-profiles="(profiles) => patchSection('workspaceRuntime', { acpProfiles: profiles })"
                  />
                </div>

                <!-- 子 Agent 委派 -->
                <div :id="sectionAnchor('subagents')" class="agent-settings-item">
                  <SubagentSettings
                    :settings="settings"
                    :apps="apps"
                    :providers="providers"
                    :busy="settingsMutationBusy"
                    @save="(patch) => patchSection('subagents', patch)"
                  />
                </div>

                <!-- 产物存储与清理配额 -->
                <div :id="sectionAnchor('storage')" class="agent-settings-item">
                  <StorageArtifactSettings
                    :settings="settings"
                    :storage="storage"
                    :busy="settingsMutationBusy"
                    @save="(patch) => patchSection('storage', patch)"
                  />
                </div>
              </section>

              <!-- 3. 插件与安全（应用、生态与安全边界） -->
              <section
                v-if="visitedGroups.has('plugins')"
                v-show="activeGroup === 'plugins'"
                id="agent-settings-plugins"
                class="agent-settings-group"
              >
                <!-- Agent App 与能力授权 -->
                <div :id="sectionAnchor('apps')" class="agent-settings-item">
                  <AppManagementSettings :apps="apps" :busy="appContextBusy" @toggle="toggleApp" @refresh="load" />
                </div>

                <!-- Durable Memory 审核、发布、撤销与跨 App 导入 -->
                <div :id="sectionAnchor('memory')" class="agent-settings-item">
                  <MemorySettings :apps="apps" :busy="appContextBusy" />
                </div>

                <!-- 插件市场与签名包管理 -->
                <div :id="sectionAnchor('plugins')" class="agent-settings-item">
                  <PluginManagementSettings
                    :apps="apps"
                    :settings="settings"
                    :busy="runtimeIntegrationBusy"
                    @refresh="load"
                    @settings-updated="(updated) => (settings = updated)"
                  />
                </div>

                <!-- 安全黑名单与系统护栏 -->
                <div :id="sectionAnchor('safety')" class="agent-settings-item">
                  <SafetyNetworkSettings :denylist="denylist" :busy="denylistBusy" @save="saveDenylist" />
                </div>
                <div :id="sectionAnchor('guardrails')" class="agent-settings-item">
                  <SystemGuardrails />
                </div>
              </section>
            </div>
          </div>
        </div>
      </template>
    </section>

    <BaseModal
      :visible="onboardingVisible && Boolean(recommendedPlugin)"
      :title="$t('agent.settings.onboarding.title')"
      :aria-label="$t('agent.settings.onboarding.title')"
      :close-on-backdrop="!featureOperationBusy"
      :close-on-escape="!featureOperationBusy"
      :focus-on-open="true"
      :restore-focus="true"
      panel-class="max-w-xl p-6 rounded-2xl shadow-2xl border border-border/80 bg-card"
      @close="closeOnboarding"
    >
      <template #header>
        <div class="flex items-center justify-between w-full pr-6">
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 via-primary/10 to-transparent text-primary ring-1 ring-primary/25 shadow-xs"
            >
              <i class="fa-solid fa-wand-magic-sparkles text-base" aria-hidden="true"></i>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 class="text-base font-semibold text-foreground tracking-tight">
                  {{ $t('agent.settings.onboarding.title') }}
                </h2>
                <span
                  class="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-success animate-pulse"></span>
                  {{ $t('agent.settings.onboarding.publisherVerified') }}
                </span>
              </div>
              <p class="text-xs text-text-secondary mt-0.5">
                {{ $t('agent.settings.onboarding.subtitle') }}
              </p>
            </div>
          </div>
        </div>
      </template>

      <template v-if="recommendedPlugin">
        <div class="space-y-4">
          <!-- 插件基础信息主卡片 -->
          <div class="relative overflow-hidden rounded-lg bg-header/25 p-4 transition-colors">
            <div class="flex items-start gap-3.5">
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 shadow-xs"
              >
                <i class="fa-solid fa-robot text-xl" aria-hidden="true"></i>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-bold text-foreground">{{ recommendedPlugin.displayName }}</span>
                  <span
                    class="rounded-md border border-border/60 bg-card px-2 py-0.5 font-mono text-[11px] font-medium text-foreground"
                  >
                    v{{ recommendedPlugin.availableVersion }}
                  </span>
                  <span class="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    {{ $t('agent.settings.onboarding.badge') }}
                  </span>
                </div>
                <p class="mt-1.5 text-xs leading-relaxed text-text-secondary">
                  {{ pluginDescription }}
                </p>
              </div>
            </div>
          </div>

          <!-- 3 栏核心特性网格 -->
          <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div class="flex items-start gap-2.5 rounded-lg bg-header/20 p-3">
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs"
              >
                <i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i>
              </div>
              <div class="min-w-0">
                <div class="text-xs font-semibold text-foreground">
                  {{ $t('agent.settings.onboarding.featureSkillsTitle') }}
                </div>
                <div class="text-[11px] text-text-secondary leading-normal mt-0.5">
                  {{ $t('agent.settings.onboarding.featureSkillsDesc') }}
                </div>
              </div>
            </div>

            <div class="flex items-start gap-2.5 rounded-lg bg-header/20 p-3">
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success text-xs"
              >
                <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
              </div>
              <div class="min-w-0">
                <div class="text-xs font-semibold text-foreground">
                  {{ $t('agent.settings.onboarding.featureSandboxTitle') }}
                </div>
                <div class="text-[11px] text-text-secondary leading-normal mt-0.5">
                  {{ $t('agent.settings.onboarding.featureSandboxDesc') }}
                </div>
              </div>
            </div>

            <div class="flex items-start gap-2.5 rounded-lg bg-header/20 p-3">
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-xs"
              >
                <i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>
              </div>
              <div class="min-w-0">
                <div class="text-xs font-semibold text-foreground">
                  {{ $t('agent.settings.onboarding.featureDecoupledTitle') }}
                </div>
                <div class="text-[11px] text-text-secondary leading-normal mt-0.5">
                  {{ $t('agent.settings.onboarding.featureDecoupledDesc') }}
                </div>
              </div>
            </div>
          </div>

          <!-- 安全凭据与发布者来源（消除裸露长串） -->
          <div class="rounded-lg bg-header/25 p-3 text-xs">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 font-medium text-foreground text-xs">
                <i class="fa-solid fa-certificate text-primary text-sm" aria-hidden="true"></i>
                <span>{{ $t('agent.settings.onboarding.verifiedPublisher') }}</span>
              </div>
              <button
                type="button"
                class="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors cursor-pointer"
                @click="showKeyDetails = !showKeyDetails"
              >
                <span>{{
                  showKeyDetails
                    ? $t('agent.settings.onboarding.hideDetails')
                    : $t('agent.settings.onboarding.detailsToggle')
                }}</span>
                <i
                  :class="showKeyDetails ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'"
                  class="text-[9px]"
                ></i>
              </button>
            </div>

            <div
              class="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card px-2.5 py-1.5 font-mono text-[11px] text-text-secondary shadow-2xs"
            >
              <div class="flex items-center gap-1.5 truncate">
                <i class="fa-solid fa-key text-[10px] text-primary/70"></i>
                <span class="truncate">{{ compactKeyId(recommendedPlugin.publisherKeyId) }}</span>
              </div>
              <button
                type="button"
                class="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-text-secondary hover:bg-header hover:text-foreground transition-colors cursor-pointer"
                @click="copyKeyId(recommendedPlugin.publisherKeyId)"
              >
                <i :class="copiedKey ? 'fa-solid fa-check text-success' : 'fa-regular fa-copy'"></i>
                <span>{{
                  copiedKey ? $t('agent.settings.onboarding.keyCopied') : $t('agent.settings.onboarding.copyKey')
                }}</span>
              </button>
            </div>

            <div
              v-if="showKeyDetails"
              class="mt-2.5 space-y-2 border-t border-border/50 pt-2.5 text-[11px] text-text-secondary"
            >
              <div>
                <div class="font-medium text-foreground">{{ $t('agent.settings.onboarding.fullKeyId') }}</div>
                <div
                  class="mt-1 break-all font-mono select-all rounded-lg border border-border/40 bg-header/40 p-2 text-foreground/90"
                >
                  {{ recommendedPlugin.publisherKeyId }}
                </div>
              </div>
              <div>
                <div class="font-medium text-foreground">{{ $t('agent.settings.onboarding.catalogSource') }}</div>
                <div
                  class="mt-1 break-all font-mono select-all rounded-lg border border-border/40 bg-header/40 p-2 text-foreground/90"
                >
                  {{ recommendedPlugin.catalogUrl }}
                </div>
              </div>
            </div>
          </div>

          <!-- 安装中进度状态（如果 busy 为 true） -->
          <div v-if="featureOperationBusy" class="rounded-xl border border-primary/25 bg-primary/5 p-4 transition-all">
            <div class="flex items-center gap-3">
              <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <i class="fa-solid fa-circle-notch fa-spin text-sm"></i>
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-xs font-semibold text-foreground">
                  {{ $t('agent.settings.onboarding.installingTitle') }}
                </div>
                <div class="text-[11px] text-text-secondary mt-0.5">
                  {{ installingStepText }}
                </div>
              </div>
            </div>
            <div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
              <div
                class="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                :style="{ width: `${installProgress}%` }"
              ></div>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <i class="fa-solid fa-lock text-[10px] text-success"></i>
            <span>{{ $t('agent.settings.onboarding.sandboxProtected') }}</span>
          </div>
          <div class="flex items-center gap-2">
            <UiButton
              appearance="soft"
              tone="neutral"
              type="button"
              :disabled="featureOperationBusy"
              @click="closeOnboarding"
            >
              {{ $t('agent.settings.onboarding.cancel') }}
            </UiButton>
            <UiButton
              appearance="solid"
              tone="primary"
              type="button"
              :disabled="featureOperationBusy"
              @click="confirmRecommendedInstall"
            >
              <i
                v-if="!featureOperationBusy"
                class="fa-solid fa-download text-xs transition-transform group-hover:-translate-y-0.5"
                aria-hidden="true"
              ></i>
              <i v-else class="fa-solid fa-circle-notch fa-spin text-xs" aria-hidden="true"></i>
              <span>{{
                featureOperationBusy
                  ? $t('agent.settings.onboarding.installing')
                  : $t('agent.settings.onboarding.installAndEnable')
              }}</span>
            </UiButton>
          </div>
        </div>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
  /*
   * 「一层卡片」：页面 → 分组卡 → 控件，中间不再叠框。
   *
   * Every settings module is its own component and brought its own card
   * (border + radius + tint + shadow). Nested inside the panel card that made
   * three or four visible frames around a single field, which is what the
   * screenshot on a phone showed. The panel card stays as the one frame; the
   * modules are merged into it as flat sections separated by hairlines, so the
   * grouping is still obvious without another border.
   *
   * The overrides only reach *direct* children of a group, so a module's own
   * internal chrome (header band, callouts, controls) is untouched.
   */
  .agent-settings-group > .agent-settings-item > :deep(*) {
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }

  .agent-settings-item + .agent-settings-item {
    border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  }

  .agent-settings-item {
    scroll-margin-top: 4.5rem;
  }

  /*
   * 模块标题带（18 个模块各写一遍的那条 `flex justify-between` 行）。
   *
   * 实测三个问题：一是 17 条灰底带子叠起来，滚起来像斑马纹（「很乱」的观感来源）；
   * 二是标题簇与动作簇之间只有 12px，右侧还会挤下 3~4 个按钮；三是窄屏下动作簇换行后
   * 直接贴左边缘，跟标题几乎连成一片。这里只改这三件事，不动各模块自己的内容排版。
   */
  .agent-settings-item :deep(.agent-settings-head) {
    gap: 12px 16px;
    padding: 14px 16px;
    background: transparent;
  }

  @media (min-width: 640px) {
    .agent-settings-item :deep(.agent-settings-head) {
      padding: 16px 20px;
    }
  }

  /* 窄屏：动作簇整行下移并左对齐，按钮不再与标题挤在一行。 */
  @media (max-width: 639px) {
    .agent-settings-item :deep(.agent-settings-head) {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  /*
   * 头部指标快照。原来是三个「标签: 数值」小方块，标签带冒号、数值跟着跑，
   * 读起来像调试输出；改成通用统计形态：图标 + 标签/数值两行，整组无框。
   */
  .agent-settings-summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 18px;
    margin: 0;
  }

  .agent-settings-summary__item {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }

  .agent-settings-summary__item > i {
    display: inline-flex;
    width: 26px;
    height: 26px;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: color-mix(in srgb, var(--text-color) 6%, transparent);
    color: var(--text-color-secondary);
    font-size: 11px;
  }

  .agent-settings-summary dt {
    font-size: 11px;
    line-height: 1.2;
    color: var(--text-color-secondary);
  }

  /* 模型 id 可以很长（gemini-3.8-flash-high）：让它自己截断，不要把「未就绪」挤到第二行。 */
  .agent-settings-summary__value {
    overflow: hidden;
    max-width: 13rem;
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-color);
    text-overflow: ellipsis;
  }

  .agent-settings-summary__value.is-ready {
    color: var(--status-success-color);
  }

  /*
   * 模块自带 z-index（Provider 卡根节点是 `relative z-20`）且 DOM 在后，
   * 同层级下会盖住粘性导航条，内容看起来像「从条上穿过去」。
   * 粘性条要压在内容之上，但仍留在全局顶栏（z-30）之下。
   */
  .agent-settings-pills {
    z-index: 29;
  }

  /*
   * 宽屏：常驻左栏分区导航 + 右侧单列内容。
   *
   * 17 个模块排在一条长流里时，用户只能靠滚动找入口，分组之间也没有
   * 可导航的结构。>=1280px 时把「分组 + 组内模块」搬到左栏，右侧只滚动
   * 当前分组；窄屏放不下左栏，仍用顶部胶囊切换分组。
   */
  .agent-settings-rail {
    display: none;
  }

  @media (min-width: 1280px) {
    .agent-settings-shell {
      display: grid;
      grid-template-columns: 15rem minmax(0, 1fr);
    }

    .agent-settings-rail {
      display: block;
      background: color-mix(in srgb, var(--header-bg-color) 45%, transparent);
      border-right: 1px solid var(--border-color);
      border-bottom-left-radius: 0.75rem;
    }

    /* 粘在全局顶栏（h-14）下面；用自身滚动兜住矮窗口。 */
    .agent-settings-rail-nav {
      position: sticky;
      top: 3.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      max-height: calc(100vh - 3.5rem);
      overflow-y: auto;
      padding: 1rem 0.75rem 1.25rem 0.875rem;
      scrollbar-width: thin;
    }

    .agent-settings-pills {
      display: none;
    }
  }

  .agent-settings-rail-heading {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.5rem;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-color-secondary);
    transition:
      color 150ms ease-in-out,
      background-color 150ms ease-in-out;
  }

  .agent-settings-rail-heading:first-child {
    margin-top: 0;
  }

  .agent-settings-rail-heading:hover {
    background: color-mix(in srgb, var(--border-color) 28%, transparent);
    color: var(--text-color);
  }

  .agent-settings-rail-heading.is-active {
    color: var(--link-active-color);
  }

  .agent-settings-rail-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0;
    margin: 0 0 0 0.375rem;
    list-style: none;
  }

  .agent-settings-rail-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem 0.375rem 0.625rem;
    border-radius: 0.5rem;
    font-size: 12px;
    line-height: 1.25rem;
    text-align: left;
    color: var(--text-color-secondary);
    transition:
      color 150ms ease-in-out,
      background-color 150ms ease-in-out;
  }

  .agent-settings-rail-item i {
    width: 0.875rem;
    flex: none;
    font-size: 11px;
    text-align: center;
    opacity: 0.75;
  }

  .agent-settings-rail-item:hover {
    background: color-mix(in srgb, var(--border-color) 30%, transparent);
    color: var(--text-color);
  }

  .agent-settings-rail-item.is-active {
    background: var(--link-active-bg-color);
    color: var(--link-active-color);
    font-weight: 600;
  }

  .agent-settings-rail-item.is-active i {
    opacity: 1;
  }
</style>
