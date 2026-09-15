<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseModal } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import {
    agentApi,
    formatAgentApiError,
    type AgentDiscoveredProviderModel,
    type AgentProviderView,
  } from '../api/agent-api';

  const props = defineProps<{
    addProviderModel: (
      provider: AgentProviderView,
      model: AgentProviderView['models'][number],
      successMsg?: string,
    ) => Promise<boolean | undefined>;
    updateProviderModels?: (
      provider: AgentProviderView,
      models: AgentProviderView['models'],
      successMsg?: string,
    ) => Promise<boolean | undefined>;
    createProvider: (input: Record<string, unknown>, successMsg?: string) => Promise<AgentProviderView | undefined>;
    providers: AgentProviderView[];
    busy: boolean;
    discoveries: Record<string, AgentDiscoveredProviderModel[]>;
    defaultProviderId: string | null;
    defaultModelId: string | null;
  }>();

  const emit = defineEmits<{
    toggle: [provider: AgentProviderView, enabled: boolean];
    discover: [provider: AgentProviderView];
    defaultModel: [providerId: string, modelId: string];
    delete: [provider: AgentProviderView];
  }>();

  const { t } = useI18n();
  const feedback = useFeedback();

  // 添加服务商弹窗状态与表单
  const modalOpen = ref(false);
  const modalTesting = ref(false);
  const modalError = ref('');
  const modalTestResult = ref<{ ok: boolean; latencyMs?: number; message?: string } | null>(null);
  const createdProviderId = ref<string | null>(null);
  const showApiKey = ref(false);
  const copiedUrl = ref<string | null>(null);

  // 模型库同步抽屉与批量策略状态
  const drawerOpen = reactive<Record<string, boolean>>({});
  const drawerLoading = reactive<Record<string, boolean>>({});
  const filterQueries = reactive<Record<string, string>>({});
  const selectedDiscovered = reactive<Record<string, Record<string, boolean>>>({});
  const selectedConfigured = reactive<Record<string, Record<string, boolean>>>({});
  const manualModelId = reactive<Record<string, string>>({});
  const drawerSaveNotices = reactive<Record<string, string>>({});
  const modalSaveNotice = ref('');
  const isSavingModels = reactive<Record<string, boolean>>({});

  const flashNotice = (providerId: string, text: string) => {
    drawerSaveNotices[providerId] = text;
    setTimeout(() => {
      if (drawerSaveNotices[providerId] === text) {
        drawerSaveNotices[providerId] = '';
      }
    }, 3000);
  };

  const flashModalNotice = (text: string) => {
    modalSaveNotice.value = text;
    setTimeout(() => {
      if (modalSaveNotice.value === text) {
        modalSaveNotice.value = '';
      }
    }, 3000);
  };

  // 删除确认
  const deletingProvider = ref<AgentProviderView | null>(null);

  // 已配置模型与连通测试模态弹窗状态
  const testModalOpen = ref(false);
  const testModalTargetProvider = ref<AgentProviderView | null>(null);
  const testModalSearch = ref('');

  const openTestModal = (provider: AgentProviderView) => {
    testModalTargetProvider.value = provider;
    testModalSearch.value = '';
    testModalOpen.value = true;
  };

  const currentTestModalProvider = computed(() => {
    if (!testModalTargetProvider.value) return null;
    return props.providers.find((p) => p.id === testModalTargetProvider.value!.id) || testModalTargetProvider.value;
  });

  const filteredTestModalModels = computed(() => {
    const provider = currentTestModalProvider.value;
    if (!provider) return [];
    const q = testModalSearch.value.trim().toLowerCase();
    if (!q) return provider.models;
    return provider.models.filter((m) => m.id.toLowerCase().includes(q));
  });

  const form = reactive({
    displayName: '',
    baseUrl: '',
    credential: '',
    modelId: '',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsTools: true,
  });

  const openAddModal = () => {
    form.displayName = '';
    form.baseUrl = '';
    form.credential = '';
    form.modelId = '';
    form.contextWindow = 128000;
    form.maxOutputTokens = 4096;
    form.supportsTools = true;
    modalError.value = '';
    modalTestResult.value = null;
    createdProviderId.value = null;
    showApiKey.value = false;
    modalOpen.value = true;
  };

  const closeModal = () => {
    if (modalTesting.value) return;
    modalOpen.value = false;
  };

  // 测试结果缓存
  const testResults = reactive<Record<string, { state: 'loading' | 'success' | 'error'; message: string }>>({});
  const testKey = (provider: AgentProviderView, modelId: string) =>
    JSON.stringify([provider.id, provider.version, modelId]);

  const testModel = async (provider: AgentProviderView, modelId: string) => {
    const key = testKey(provider, modelId);
    if (testResults[key]?.state === 'loading') return;
    testResults[key] = { state: 'loading', message: t('agent.ui.testing') };
    try {
      const result = await agentApi.testProvider(provider.id, modelId);
      if (result.ok) {
        const latencyText = `${result.latencyMs}ms`;
        testResults[key] = { state: 'success', message: latencyText };
        feedback.notifySuccess(
          `${provider.displayName} · ${modelId}: ${t('agent.settings.providers.testPassed')} (${latencyText})`,
        );
      } else {
        testResults[key] = { state: 'error', message: t('agent.ui.testFailed') };
        feedback.notifyError(
          `${provider.displayName} · ${modelId}: ${t('agent.settings.providers.testFailedMessage')}`,
        );
      }
    } catch (cause) {
      const errMsg = formatAgentApiError(cause, t('agent.ui.testFailed'));
      testResults[key] = { state: 'error', message: errMsg };
      feedback.notifyError(`${provider.displayName} · ${modelId}: ${errMsg}`);
    }
  };

  // 弹窗内的连通性测试
  const testInModal = async () => {
    modalError.value = '';
    modalTestResult.value = null;

    if (!form.displayName.trim()) {
      modalError.value = t('agent.settings.providers.name') + ' 不能为空';
      return;
    }
    if (!form.baseUrl.trim()) {
      modalError.value = t('agent.settings.providers.baseUrl') + ' 不能为空';
      return;
    }
    if (!form.modelId.trim()) {
      modalError.value = t('agent.settings.providers.model') + ' 不能为空';
      return;
    }

    modalTesting.value = true;
    try {
      let targetProviderId = createdProviderId.value;

      // 如果尚未保存，先通过 createProvider 建立服务商记录
      if (!targetProviderId) {
        const payload = {
          kind: 'openai-compatible',
          displayName: form.displayName.trim(),
          baseUrl: form.baseUrl.trim(),
          ...(form.credential.trim() ? { credential: form.credential.trim() } : {}),
          models: [
            {
              id: form.modelId.trim(),
              contextWindow: form.contextWindow,
              maxOutputTokens: form.maxOutputTokens,
              supportsTools: form.supportsTools,
            },
          ],
          enabled: true,
        };

        const saved = await props.createProvider(payload);
        if (!saved) {
          modalError.value = t('agent.ui.createFailed');
          return;
        }

        createdProviderId.value = saved.id;
        targetProviderId = saved.id;
      }

      if (targetProviderId) {
        const testRes = await agentApi.testProvider(targetProviderId, form.modelId.trim());
        if (testRes.ok) {
          const latencyText = `${testRes.latencyMs}ms`;
          const successMsg = `${t('agent.settings.providers.testPassed')} (${latencyText})`;
          modalTestResult.value = {
            ok: true,
            latencyMs: testRes.latencyMs,
            message: successMsg,
          };
          feedback.notifySuccess(`${form.displayName.trim() || form.modelId.trim()}: ${successMsg}`);
        } else {
          const failMsg = t('agent.settings.providers.testFailedMessage');
          modalTestResult.value = {
            ok: false,
            message: failMsg,
          };
          feedback.notifyError(`${form.displayName.trim() || form.modelId.trim()}: ${failMsg}`);
        }
      }
    } catch (cause) {
      const errMsg = formatAgentApiError(cause, t('agent.settings.providers.testFailedMessage'));
      modalTestResult.value = {
        ok: false,
        message: errMsg,
      };
      feedback.notifyError(errMsg);
    } finally {
      modalTesting.value = false;
    }
  };

  // 弹窗确认添加
  const submitModal = async () => {
    if (createdProviderId.value) {
      modalOpen.value = false;
      return;
    }

    modalError.value = '';
    if (!form.displayName.trim() || !form.baseUrl.trim() || !form.modelId.trim()) {
      modalError.value = '请补全服务商与模型必填信息';
      return;
    }

    modalTesting.value = true;
    try {
      const payload = {
        kind: 'openai-compatible',
        displayName: form.displayName.trim(),
        baseUrl: form.baseUrl.trim(),
        ...(form.credential.trim() ? { credential: form.credential.trim() } : {}),
        models: [
          {
            id: form.modelId.trim(),
            contextWindow: form.contextWindow,
            maxOutputTokens: form.maxOutputTokens,
            supportsTools: form.supportsTools,
          },
        ],
        enabled: true,
      };

      const saved = await props.createProvider(payload);
      if (saved) {
        modalOpen.value = false;
      } else {
        modalError.value = t('agent.ui.createFailed');
      }
    } catch (cause) {
      modalError.value = formatAgentApiError(cause, t('agent.ui.createFailed'));
    } finally {
      modalTesting.value = false;
    }
  };

  // 触发更新模型并打开抽屉
  const triggerDiscover = (provider: AgentProviderView) => {
    drawerOpen[provider.id] = true;
    drawerLoading[provider.id] = true;
    emit('discover', provider);
    setTimeout(() => {
      drawerLoading[provider.id] = false;
    }, 1500);
  };

  const toggleDrawer = (provider: AgentProviderView) => {
    if (drawerOpen[provider.id]) {
      drawerOpen[provider.id] = false;
    } else {
      triggerDiscover(provider);
    }
  };

  // 可添加（未配置）的发现模型列表
  const availableDiscoveries = (provider: AgentProviderView): AgentDiscoveredProviderModel[] => {
    const configured = new Set(provider.models.map((m) => m.id));
    return (props.discoveries[provider.id] ?? []).filter((m) => !configured.has(m.id));
  };

  // 过滤后的可添加列表
  const filteredAvailable = (provider: AgentProviderView): AgentDiscoveredProviderModel[] => {
    const query = (filterQueries[provider.id] || '').trim().toLowerCase();
    const all = availableDiscoveries(provider);
    if (!query) return all;
    return all.filter(
      (m) => m.id.toLowerCase().includes(query) || (m.ownedBy && m.ownedBy.toLowerCase().includes(query)),
    );
  };

  // 选中的可添加模型数量
  const selectedDiscoveredCount = (provider: AgentProviderView): number => {
    const map = selectedDiscovered[provider.id] || {};
    return filteredAvailable(provider).filter((m) => map[m.id]).length;
  };

  // 全选/取消全选可添加模型
  const isAllDiscoveredSelected = (provider: AgentProviderView): boolean => {
    const list = filteredAvailable(provider);
    if (!list.length) return false;
    const map = selectedDiscovered[provider.id] || {};
    return list.every((m) => map[m.id]);
  };

  const toggleSelectAllDiscovered = (provider: AgentProviderView) => {
    const list = filteredAvailable(provider);
    if (!list.length) return;
    const allSelected = isAllDiscoveredSelected(provider);
    if (!selectedDiscovered[provider.id]) selectedDiscovered[provider.id] = {};
    for (const m of list) {
      selectedDiscovered[provider.id][m.id] = !allSelected;
    }
  };

  const toggleDiscoveredItem = (provider: AgentProviderView, modelId: string) => {
    if (!selectedDiscovered[provider.id]) selectedDiscovered[provider.id] = {};
    selectedDiscovered[provider.id][modelId] = !selectedDiscovered[provider.id][modelId];
  };

  // 选中的已配置模型数量
  const selectedConfiguredCount = (provider: AgentProviderView): number => {
    const map = selectedConfigured[provider.id] || {};
    return provider.models.filter(
      (model) =>
        map[model.id] &&
        provider.models.length > 1 &&
        !(provider.id === props.defaultProviderId && model.id === props.defaultModelId),
    ).length;
  };

  const toggleConfiguredItem = (provider: AgentProviderView, modelId: string) => {
    if (!selectedConfigured[provider.id]) selectedConfigured[provider.id] = {};
    selectedConfigured[provider.id][modelId] = !selectedConfigured[provider.id][modelId];
  };

  // 统一更新方法
  const updateModels = async (
    provider: AgentProviderView,
    models: AgentProviderView['models'],
    successMsg?: string,
  ): Promise<boolean> => {
    if (props.updateProviderModels) {
      const ok = await props.updateProviderModels(provider, models, successMsg);
      return Boolean(ok);
    }
    try {
      await agentApi.updateProvider(provider, { models });
      feedback.notifySuccess(successMsg ?? t('agent.ui.saved'));
      return true;
    } catch (cause) {
      const errMsg = formatAgentApiError(cause, t('agent.ui.createFailed'));
      feedback.notifyError(errMsg);
      return false;
    }
  };

  const discoveredModelConfig = (provider: AgentProviderView, modelId: string): AgentProviderView['models'][number] => {
    const discovered = (props.discoveries[provider.id] ?? []).find((model) => model.id === modelId);
    const defaults = discovered?.registryDefaults;
    const hasRegistryDefaults =
      defaults?.contextWindow !== undefined &&
      defaults.maxOutputTokens !== undefined &&
      defaults.supportsTools !== undefined;
    const contextWindow = hasRegistryDefaults ? defaults.contextWindow! : 128000;
    const maxOutputTokens = hasRegistryDefaults ? defaults.maxOutputTokens! : 4096;
    const supportsTools = hasRegistryDefaults ? defaults.supportsTools! : true;
    return {
      id: modelId,
      contextWindow,
      maxOutputTokens,
      supportsTools,
      capabilitySources: {
        contextWindow: hasRegistryDefaults ? 'registry' : 'manual',
        maxOutputTokens: hasRegistryDefaults ? 'registry' : 'manual',
        supportsTools: hasRegistryDefaults ? 'registry' : 'manual',
        ...(defaults?.reasoning ? { reasoning: 'registry' as const } : {}),
      },
      ...(defaults ? { registryDefaults: defaults } : {}),
      ...(defaults?.reasoning
        ? {
            reasoningEfforts: [...defaults.reasoning.supportedEfforts],
            ...(defaults.reasoning.defaultEffort === undefined
              ? {}
              : { defaultReasoningEffort: defaults.reasoning.defaultEffort }),
            reasoningSource: 'registry' as const,
            ...(defaults.reasoning.mandatory === undefined ? {} : { reasoningMandatory: defaults.reasoning.mandatory }),
            ...(defaults.reasoning.supportsMaxTokens === undefined
              ? {}
              : { reasoningSupportsMaxTokens: defaults.reasoning.supportsMaxTokens }),
          }
        : {}),
    };
  };

  const capabilityEditor = ref<{ providerId: string; modelId: string } | null>(null);
  const capabilityForm = reactive({ contextWindow: 1, maxOutputTokens: 1, supportsTools: false });

  const capabilityEditorProvider = computed(() =>
    capabilityEditor.value
      ? (props.providers.find((provider) => provider.id === capabilityEditor.value?.providerId) ?? null)
      : null,
  );
  const capabilityEditorModel = computed(() =>
    capabilityEditorProvider.value && capabilityEditor.value
      ? (capabilityEditorProvider.value.models.find((model) => model.id === capabilityEditor.value?.modelId) ?? null)
      : null,
  );

  const openCapabilityEditor = (provider: AgentProviderView, model: AgentProviderView['models'][number]): void => {
    capabilityEditor.value = { providerId: provider.id, modelId: model.id };
    capabilityForm.contextWindow = model.contextWindow;
    capabilityForm.maxOutputTokens = model.maxOutputTokens;
    capabilityForm.supportsTools = model.supportsTools;
  };

  const closeCapabilityEditor = (): void => {
    if (props.busy) return;
    capabilityEditor.value = null;
  };

  const restoreCapabilityField = (field: 'contextWindow' | 'maxOutputTokens' | 'supportsTools'): void => {
    const defaults = capabilityEditorModel.value?.registryDefaults;
    if (!defaults || defaults[field] === undefined) return;
    if (field === 'supportsTools') capabilityForm.supportsTools = Boolean(defaults.supportsTools);
    else capabilityForm[field] = Number(defaults[field]);
  };

  const restoreAllCapabilities = (): void => {
    restoreCapabilityField('contextWindow');
    restoreCapabilityField('maxOutputTokens');
    restoreCapabilityField('supportsTools');
  };

  const capabilityFieldIsDefault = (field: 'contextWindow' | 'maxOutputTokens' | 'supportsTools'): boolean => {
    const defaults = capabilityEditorModel.value?.registryDefaults;
    if (!defaults || defaults[field] === undefined) return false;
    return capabilityForm[field] === defaults[field];
  };

  const saveCapabilities = async (): Promise<void> => {
    const provider = capabilityEditorProvider.value;
    const model = capabilityEditorModel.value;
    if (!provider || !model) return;
    if (
      !Number.isSafeInteger(capabilityForm.contextWindow) ||
      capabilityForm.contextWindow < 2 ||
      !Number.isSafeInteger(capabilityForm.maxOutputTokens) ||
      capabilityForm.maxOutputTokens < 1 ||
      capabilityForm.maxOutputTokens >= capabilityForm.contextWindow
    ) {
      feedback.notifyError(t('agent.settings.providers.capabilityInvalid'));
      return;
    }
    const next = provider.models.map((candidate) =>
      candidate.id === model.id
        ? {
            ...candidate,
            contextWindow: capabilityForm.contextWindow,
            maxOutputTokens: capabilityForm.maxOutputTokens,
            supportsTools: capabilityForm.supportsTools,
          }
        : candidate,
    );
    const saved = await updateModels(provider, next, t('agent.settings.providers.capabilitySaved'));
    if (saved) capabilityEditor.value = null;
  };

  // 一键添加所有支持模型
  const addAllDiscovered = async (provider: AgentProviderView): Promise<void> => {
    const available = availableDiscoveries(provider);
    if (!available.length) return;
    isSavingModels[provider.id] = true;
    try {
      const newModels = available.map((model) => discoveredModelConfig(provider, model.id));
      const noticeAdded = t('agent.settings.providers.saveNoticeAdded', { count: available.length });
      const saved = await updateModels(provider, [...provider.models, ...newModels], noticeAdded);
      if (!saved) return;
      selectedDiscovered[provider.id] = {};
      flashNotice(provider.id, noticeAdded);
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 多选添加所选模型
  const addSelectedDiscovered = async (provider: AgentProviderView): Promise<void> => {
    const map = selectedDiscovered[provider.id] || {};
    const selectedIds = Object.keys(map).filter((id) => map[id]);
    if (!selectedIds.length) return;
    isSavingModels[provider.id] = true;
    try {
      const newModels = selectedIds.map((id) => discoveredModelConfig(provider, id));
      const noticeSelected = t('agent.settings.providers.saveNoticeAdded', { count: selectedIds.length });
      const saved = await updateModels(provider, [...provider.models, ...newModels], noticeSelected);
      if (!saved) return;
      selectedDiscovered[provider.id] = {};
      flashNotice(provider.id, noticeSelected);
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 单项快捷添加
  const addSingleDiscovered = async (provider: AgentProviderView, modelId: string): Promise<void> => {
    isSavingModels[provider.id] = true;
    try {
      const newModel = discoveredModelConfig(provider, modelId);
      const noticeSingle = t('agent.settings.providers.saveNoticeAdded', { count: 1 });
      const saved = await updateModels(provider, [...provider.models, newModel], noticeSingle);
      if (!saved) return;
      if (selectedDiscovered[provider.id]) {
        delete selectedDiscovered[provider.id][modelId];
      }
      flashNotice(provider.id, noticeSingle);
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 取消已添加（单项）
  const removeConfiguredModel = async (provider: AgentProviderView, modelId: string): Promise<void> => {
    if (provider.models.length <= 1) return;
    isSavingModels[provider.id] = true;
    try {
      const nextModels = provider.models.filter((m) => m.id !== modelId);
      if (props.defaultProviderId === provider.id && props.defaultModelId === modelId && nextModels[0]) {
        emit('defaultModel', provider.id, nextModels[0].id);
      }
      const noticeRemoved = t('agent.settings.providers.saveNoticeRemoved');
      const saved = await updateModels(provider, nextModels, noticeRemoved);
      if (!saved) return;
      if (selectedConfigured[provider.id]) {
        delete selectedConfigured[provider.id][modelId];
      }
      flashNotice(provider.id, noticeRemoved);
      flashModalNotice(noticeRemoved);
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 取消已添加（多选批量取消）
  const removeSelectedConfigured = async (provider: AgentProviderView): Promise<void> => {
    const map = selectedConfigured[provider.id] || {};
    const removableIds = new Set(removableConfiguredModels(provider).map((model) => model.id));
    const selectedIds = new Set(Object.keys(map).filter((id) => map[id] && removableIds.has(id)));
    if (!selectedIds.size) return;
    const nextModels = provider.models.filter((m) => !selectedIds.has(m.id));
    if (!nextModels.length) return;
    isSavingModels[provider.id] = true;
    try {
      const noticeBatchRemoved = t('agent.settings.providers.saveNoticeRemoved');
      const saved = await updateModels(provider, nextModels, noticeBatchRemoved);
      if (!saved) return;
      selectedConfigured[provider.id] = {};
      flashNotice(provider.id, noticeBatchRemoved);
      flashModalNotice(noticeBatchRemoved);
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 获取服务商中所有可安全移除的模型（必须保留至少一个核心模型：优先保留系统默认模型，否则保留首个模型）
  const removableConfiguredModels = (provider: AgentProviderView): AgentProviderView['models'] => {
    if (provider.models.length <= 1) return [];
    const isDefaultProvider = props.defaultProviderId === provider.id;
    const hasDefaultModel = provider.models.some((m) => m.id === props.defaultModelId);
    const keepModelId = isDefaultProvider && hasDefaultModel ? props.defaultModelId : provider.models[0]?.id;
    return provider.models.filter((m) => m.id !== keepModelId);
  };

  // 是否已全选所有可移除模型
  const isAllConfiguredSelected = (provider: AgentProviderView): boolean => {
    const list = removableConfiguredModels(provider);
    if (!list.length) return false;
    const map = selectedConfigured[provider.id] || {};
    return list.every((m) => Boolean(map[m.id]));
  };

  // 全选/取消全选可移除模型
  const toggleSelectAllConfigured = (provider: AgentProviderView) => {
    const list = removableConfiguredModels(provider);
    if (!list.length) return;
    const allSelected = isAllConfiguredSelected(provider);
    if (!selectedConfigured[provider.id]) selectedConfigured[provider.id] = {};
    for (const m of list) {
      selectedConfigured[provider.id][m.id] = !allSelected;
    }
  };

  // 一键移除所有可删除模型（保留默认主力模型或首个基础模型）
  const removeAllConfigured = async (provider: AgentProviderView): Promise<void> => {
    const removable = removableConfiguredModels(provider);
    if (!removable.length) return;
    const removeCount = removable.length;
    isSavingModels[provider.id] = true;
    try {
      const removableIds = new Set(removable.map((m) => m.id));
      const nextModels = provider.models.filter((m) => !removableIds.has(m.id));
      if (!nextModels.length && provider.models[0]) {
        nextModels.push(provider.models[0]);
      }
      const noticeAllRemoved = t('agent.settings.providers.saveNoticeRemovedAll', { count: removeCount });
      const saved = await updateModels(provider, nextModels, noticeAllRemoved);
      if (!saved) return;
      selectedConfigured[provider.id] = {};
      flashNotice(provider.id, noticeAllRemoved);
      flashModalNotice(noticeAllRemoved);
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 手动输入添加
  const addManualModel = async (provider: AgentProviderView): Promise<void> => {
    const id = (manualModelId[provider.id] || '').trim();
    if (!id) return;
    if (provider.models.some((m) => m.id === id)) {
      manualModelId[provider.id] = '';
      return;
    }
    isSavingModels[provider.id] = true;
    try {
      const newModel = discoveredModelConfig(provider, id);
      const noticeManual = t('agent.settings.providers.saveNoticeAdded', { count: 1 });
      const saved = await updateModels(provider, [...provider.models, newModel], noticeManual);
      if (!saved) return;
      manualModelId[provider.id] = '';
      flashNotice(provider.id, noticeManual);
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 默认模型下拉选择浮层状态
  const defaultDropdownOpen = ref(false);
  const defaultModelSearch = ref('');
  const defaultDropdownRef = ref<HTMLElement | null>(null);

  const selectedDefaultOption = computed(() => {
    if (!props.defaultProviderId || !props.defaultModelId) return null;
    return (
      modelOptions.value.find(
        (opt) => opt.provider.id === props.defaultProviderId && opt.model.id === props.defaultModelId,
      ) || null
    );
  });

  const filteredDefaultModelOptions = computed(() => {
    const q = defaultModelSearch.value.trim().toLowerCase();
    if (!q) return modelOptions.value;
    return modelOptions.value.filter(
      (opt) => opt.model.id.toLowerCase().includes(q) || opt.provider.displayName.toLowerCase().includes(q),
    );
  });

  const toggleDefaultDropdown = () => {
    if (props.busy || modelOptions.value.length === 0) return;
    defaultDropdownOpen.value = !defaultDropdownOpen.value;
    if (defaultDropdownOpen.value) {
      defaultModelSearch.value = '';
    }
  };

  const selectDefaultOption = (opt: (typeof modelOptions.value)[number]) => {
    emit('defaultModel', opt.provider.id, opt.model.id);
    defaultDropdownOpen.value = false;
    defaultModelSearch.value = '';
  };

  const handleDocumentClick = (e: MouseEvent) => {
    if (defaultDropdownOpen.value && defaultDropdownRef.value) {
      if (!defaultDropdownRef.value.contains(e.target as Node)) {
        defaultDropdownOpen.value = false;
      }
    }
  };

  onMounted(() => {
    document.addEventListener('click', handleDocumentClick);
  });

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleDocumentClick);
  });

  // 辅助计算
  const modelOptions = computed(() =>
    props.providers
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.models.map((m) => ({
          key: `${p.id}\u0000${m.id}`,
          provider: p,
          model: m,
        })),
      ),
  );

  const defaultModelKey = computed(() =>
    props.defaultProviderId && props.defaultModelId ? `${props.defaultProviderId}\u0000${props.defaultModelId}` : '',
  );

  const modelCount = computed(() => props.providers.reduce((total, p) => total + p.models.length, 0));

  const compactTokens = (value: number): string => {
    if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
    if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
    return String(value);
  };

  const setDefaultModel = (value: string): void => {
    const option = modelOptions.value.find((c) => c.key === value);
    if (option) emit('defaultModel', option.provider.id, option.model.id);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      copiedUrl.value = text;
      setTimeout(() => {
        copiedUrl.value = null;
      }, 1500);
    } catch {
      // ignore
    }
  };

  const providerIcon = (provider: AgentProviderView): string => {
    const name = provider.displayName.toLowerCase();
    const url = provider.baseUrl.toLowerCase();
    if (name.includes('openai') || url.includes('openai')) return 'fa-solid fa-bolt text-emerald-500';
    if (name.includes('deepseek') || url.includes('deepseek')) return 'fa-solid fa-wand-magic-sparkles text-primary';
    if (name.includes('moonshot') || name.includes('kimi') || url.includes('moonshot'))
      return 'fa-solid fa-moon text-blue-500';
    if (name.includes('ollama') || url.includes('localhost') || url.includes('127.0.0.1'))
      return 'fa-solid fa-server text-amber-500';
    if (name.includes('silicon') || url.includes('siliconflow')) return 'fa-solid fa-microchip text-indigo-500';
    return 'fa-solid fa-cube text-text-secondary';
  };

  const confirmDelete = () => {
    if (!deletingProvider.value) return;
    emit('delete', deletingProvider.value);
    deletingProvider.value = null;
  };
</script>

<template>
  <section class="relative z-20 rounded-2xl border border-border/70 bg-card/25 shadow-xs transition-all">
    <!-- 头部工具栏与统计 -->
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/35 px-4 py-3 sm:px-5 sm:py-3.5 rounded-t-2xl"
    >
      <div>
        <div class="flex items-center gap-2.5">
          <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.providers.title') }}</h3>
          <span
            class="rounded-full border border-border/70 bg-background/80 px-2.5 py-0.5 text-[11px] font-medium text-text-secondary"
          >
            {{ $t('agent.settings.providers.counts', { providers: providers.length, models: modelCount }) }}
          </span>
        </div>
        <p class="mt-0.5 text-xs text-text-secondary">{{ $t('agent.settings.providers.description') }}</p>
      </div>

      <!-- 添加服务商主按钮 -->
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50 cursor-pointer"
        :disabled="busy"
        @click="openAddModal"
      >
        <i class="fa-solid fa-plus text-xs" aria-hidden="true"></i>
        <span>{{ $t('agent.settings.providers.add') }}</span>
      </button>
    </div>

    <div class="space-y-4 p-4 sm:p-5">
      <!-- 默认模型选择微岛（现代定制无原生边框） -->
      <div
        class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/70 bg-header/25 p-3.5 transition-all relative z-10"
      >
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <i class="fa-solid fa-robot text-sm" aria-hidden="true"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <div class="text-xs font-semibold text-foreground">{{ $t('agent.settings.providers.defaultModel') }}</div>
              <span
                class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.2 text-[9px] font-medium text-emerald-600 dark:text-emerald-400"
              >
                <i class="fa-solid fa-cloud-arrow-up text-[8px]"></i>
                <span>{{ $t('agent.settings.providers.autoSaved') }}</span>
              </span>
            </div>
            <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.providers.defaultModelHint') }}</div>
          </div>
        </div>

        <div ref="defaultDropdownRef" class="relative min-w-64 max-w-sm">
          <!-- 默认模型现代触发器：优先显示模型 ID，渠道作为精致小微徽标排在后面 -->
          <button
            type="button"
            class="flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-border/80 bg-background/95 px-3 text-xs font-medium text-foreground shadow-2xs outline-none transition-all hover:border-border-hover cursor-pointer disabled:opacity-50"
            :class="{ 'border-primary/60 ring-2 ring-primary/15': defaultDropdownOpen }"
            :disabled="busy || modelOptions.length === 0"
            :aria-label="$t('agent.settings.providers.defaultModel')"
            @click="toggleDefaultDropdown"
          >
            <div v-if="selectedDefaultOption" class="flex items-center gap-2 min-w-0 overflow-hidden">
              <i :class="providerIcon(selectedDefaultOption.provider)" class="text-xs shrink-0"></i>
              <!-- 优先大字显示模型 ID -->
              <span class="font-mono text-xs font-semibold text-foreground truncate">
                {{ selectedDefaultOption.model.id }}
              </span>
              <!-- 渠道小巧精致徽标，视觉轻量优雅 -->
              <span
                class="shrink-0 rounded-md border border-border/60 bg-header/50 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary leading-none"
              >
                {{ selectedDefaultOption.provider.displayName }}
              </span>
            </div>
            <div v-else class="text-xs text-text-secondary truncate">
              {{ $t('agent.settings.providers.chooseDefault') }}
            </div>
            <i
              class="fa-solid fa-chevron-down text-[10px] text-text-secondary transition-transform duration-200 shrink-0"
              :class="{ 'rotate-180 text-foreground': defaultDropdownOpen }"
            ></i>
          </button>

          <!-- 展开后的模型选择面板 -->
          <div
            v-if="defaultDropdownOpen"
            class="absolute right-0 top-full mt-1.5 z-50 w-full min-w-72 max-w-sm rounded-xl border border-border/80 bg-card/98 p-1.5 shadow-xl backdrop-blur-md transition-all"
          >
            <!-- 搜索框（当选项多于 3 个时显示） -->
            <div v-if="modelOptions.length > 3" class="relative mb-1.5 px-1 pt-1">
              <i
                class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary/70 pointer-events-none"
              ></i>
              <input
                v-model="defaultModelSearch"
                type="text"
                data-no-highlight
                class="h-7.5 w-full rounded-lg border border-border/70 bg-header/30 pl-7 pr-2.5 text-xs text-foreground placeholder:text-text-secondary/60 outline-none focus:border-border-hover"
                :placeholder="$t('agent.settings.providers.searchConfiguredModels')"
                @click.stop
              />
            </div>

            <!-- 选项滚动列表 -->
            <div class="max-h-60 overflow-y-auto space-y-1 pr-0.5">
              <button
                v-for="option in filteredDefaultModelOptions"
                :key="option.key"
                type="button"
                class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-all cursor-pointer"
                :class="
                  defaultProviderId === option.provider.id && defaultModelId === option.model.id
                    ? 'bg-primary/10 text-primary font-semibold border border-primary/20'
                    : 'text-foreground hover:bg-header/60 border border-transparent'
                "
                @click="selectDefaultOption(option)"
              >
                <div class="flex items-center gap-2 min-w-0 flex-1">
                  <i :class="providerIcon(option.provider)" class="text-xs shrink-0"></i>
                  <!-- 优先突出模型 ID -->
                  <span
                    class="font-mono text-xs font-medium truncate"
                    :class="{
                      'font-bold': defaultProviderId === option.provider.id && defaultModelId === option.model.id,
                    }"
                  >
                    {{ option.model.id }}
                  </span>
                </div>

                <div class="flex items-center gap-1.5 shrink-0">
                  <!-- 渠道小一点、好看一点 -->
                  <span
                    class="rounded-md border border-border/60 bg-header/40 px-1.5 py-0.5 text-[10px] text-text-secondary leading-none"
                    :class="{
                      'border-primary/30 text-primary/80':
                        defaultProviderId === option.provider.id && defaultModelId === option.model.id,
                    }"
                  >
                    {{ option.provider.displayName }}
                  </span>
                  <i
                    v-if="defaultProviderId === option.provider.id && defaultModelId === option.model.id"
                    class="fa-solid fa-check text-xs text-primary ml-0.5"
                  ></i>
                </div>
              </button>

              <div v-if="filteredDefaultModelOptions.length === 0" class="py-4 text-center text-xs text-text-secondary">
                未匹配到模型
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 服务商列表（简炼高质感堆叠卡片） -->
      <div v-if="providers.length > 0" class="space-y-3">
        <article
          v-for="provider in providers"
          :key="provider.id"
          class="rounded-xl border border-border/65 bg-background/60 shadow-2xs transition-all hover:border-border/90"
        >
          <!-- 服务商顶行摘要 -->
          <div class="flex flex-wrap items-center justify-between gap-3 p-3.5">
            <!-- 左侧核心身份 -->
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-header/70 border border-border/60 text-foreground"
              >
                <i :class="providerIcon(provider)" class="text-sm"></i>
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-sm text-foreground truncate">{{ provider.displayName }}</span>
                  <span
                    class="inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-medium"
                    :class="
                      provider.enabled
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                        : 'bg-header text-text-secondary border border-border/60'
                    "
                  >
                    <span
                      class="h-1.5 w-1.5 rounded-full"
                      :class="provider.enabled ? 'bg-emerald-500' : 'bg-text-secondary'"
                    ></span>
                    {{
                      provider.enabled
                        ? $t('agent.settings.providers.enabled')
                        : $t('agent.settings.providers.disabled')
                    }}
                  </span>
                  <button
                    type="button"
                    class="rounded-md bg-header/60 border border-border/60 px-1.5 py-0.2 font-mono text-[10px] text-text-secondary hover:border-primary/50 hover:bg-primary/10 hover:text-primary transition-all cursor-pointer"
                    :title="$t('agent.settings.providers.testModalTitle')"
                    @click="openTestModal(provider)"
                  >
                    <i class="fa-solid fa-layer-group text-[9px] mr-1"></i>
                    <span>{{ provider.models.length }} 个模型</span>
                  </button>
                  <span
                    v-if="provider.hasCredential"
                    class="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"
                  >
                    <i class="fa-solid fa-key text-[9px]"></i>
                    <span>已配密钥</span>
                  </span>
                </div>

                <!-- 次级行：紧凑 URL 与快捷复制 -->
                <div class="flex items-center gap-1.5 text-xs text-text-secondary/70 mt-1">
                  <span class="font-mono text-[11px] truncate max-w-xs sm:max-w-md">{{ provider.baseUrl }}</span>
                  <button
                    type="button"
                    class="hover:text-foreground transition-colors cursor-pointer"
                    :title="
                      copiedUrl === provider.baseUrl ? $t('agent.settings.providers.copyUrlSuccess') : '复制接口地址'
                    "
                    @click="copyText(provider.baseUrl)"
                  >
                    <i
                      :class="
                        copiedUrl === provider.baseUrl ? 'fa-solid fa-check text-emerald-500' : 'fa-regular fa-copy'
                      "
                      class="text-[10px]"
                    ></i>
                  </button>
                </div>
              </div>
            </div>

            <!-- 右侧操作工具条 -->
            <div class="flex items-center gap-1.5 shrink-0">
              <!-- 查看已配模型并进行连通测试弹窗入口 -->
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-lg border border-border/75 bg-card px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-header hover:text-foreground transition-all cursor-pointer shadow-2xs"
                :title="$t('agent.settings.providers.testModalTitle')"
                :disabled="busy"
                @click="openTestModal(provider)"
              >
                <i class="fa-solid fa-vial text-xs text-primary" aria-hidden="true"></i>
                <span class="hidden sm:inline">{{
                  $t('agent.settings.providers.testModalBtn', { count: provider.models.length })
                }}</span>
              </button>

              <!-- 更新模型（抽屉式同步） -->
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer shadow-2xs"
                :class="
                  drawerOpen[provider.id]
                    ? 'border-primary/60 bg-primary/10 text-primary font-semibold'
                    : 'border-border/75 bg-card text-text-secondary hover:bg-header hover:text-foreground'
                "
                :title="$t('agent.settings.providers.discover')"
                :disabled="busy"
                @click="toggleDrawer(provider)"
              >
                <i
                  class="fa-solid fa-arrows-rotate text-xs"
                  :class="{ 'fa-spin': busy || drawerLoading[provider.id] }"
                ></i>
                <span class="hidden sm:inline">{{ $t('agent.settings.providers.discover') }}</span>
              </button>

              <!-- 启停状态切换 -->
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer shadow-2xs"
                :class="
                  provider.enabled
                    ? 'border border-border/75 bg-card text-text-secondary hover:bg-header hover:text-foreground'
                    : 'bg-primary text-white hover:bg-primary/90'
                "
                :disabled="busy"
                @click="emit('toggle', provider, !provider.enabled)"
              >
                {{ provider.enabled ? $t('agent.settings.providers.disable') : $t('agent.settings.providers.enable') }}
              </button>

              <!-- 删除服务商 -->
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary hover:bg-error/10 hover:text-error transition-colors cursor-pointer"
                :title="$t('agent.settings.providers.deleteConfirm')"
                :disabled="busy"
                @click="deletingProvider = provider"
              >
                <i class="fa-regular fa-trash-can text-xs"></i>
              </button>
            </div>
          </div>

          <!-- 更新模型抽屉区（高质感多选、全选、一键添加与取消已添加） -->
          <div
            v-if="drawerOpen[provider.id]"
            class="border-t border-border/50 bg-header/15 p-3.5 sm:p-4 transition-all"
          >
            <!-- 抽屉顶部横栏 -->
            <div class="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-border/50">
              <div class="flex items-center gap-2">
                <div class="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <i
                    class="fa-solid fa-arrows-rotate text-xs"
                    :class="{ 'fa-spin': busy || drawerLoading[provider.id] }"
                  ></i>
                </div>
                <span class="text-xs font-bold text-foreground">{{ $t('agent.settings.providers.drawerTitle') }}</span>
                <span
                  class="rounded-md border border-border/70 bg-card px-2 py-0.5 text-[10px] font-mono text-text-secondary"
                >
                  {{ $t('agent.settings.providers.discoveredModels') }}: {{ availableDiscoveries(provider).length }}
                </span>
                <span
                  class="rounded-md border border-border/70 bg-card px-2 py-0.5 text-[10px] font-mono text-text-secondary"
                >
                  {{ $t('agent.settings.providers.configuredModels') }}: {{ provider.models.length }}
                </span>

                <!-- 实时自动保存指示微胶囊 -->
                <span
                  v-if="isSavingModels[provider.id]"
                  class="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/25 px-2 py-0.5 text-[10px] font-medium text-primary"
                >
                  <i class="fa-solid fa-circle-notch fa-spin text-[9px]"></i>
                  <span>{{ $t('agent.settings.providers.saving') }}</span>
                </span>
                <span
                  v-else
                  class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                >
                  <i class="fa-solid fa-cloud-arrow-up text-[9px]"></i>
                  <span>{{ $t('agent.settings.providers.autoSaved') }}</span>
                </span>
              </div>

              <div class="flex items-center">
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-header hover:text-foreground transition-all cursor-pointer shadow-2xs"
                  :disabled="busy || drawerLoading[provider.id]"
                  :title="$t('agent.settings.providers.discover')"
                  @click="triggerDiscover(provider)"
                >
                  <i
                    class="fa-solid fa-arrows-rotate text-xs"
                    :class="{ 'fa-spin': busy || drawerLoading[provider.id] }"
                  ></i>
                  <span class="hidden sm:inline">{{ $t('agent.settings.providers.discover') }}</span>
                </button>
              </div>
            </div>

            <!-- 顶部即时保存闪现通知条 (Flash Notice) -->
            <div
              v-if="drawerSaveNotices[provider.id]"
              class="mt-2.5 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300 transition-all"
            >
              <div class="flex items-center gap-2">
                <i class="fa-solid fa-circle-check text-emerald-500 text-xs"></i>
                <span class="font-medium">{{ drawerSaveNotices[provider.id] }}</span>
              </div>
              <span class="text-[10px] text-emerald-600/75 dark:text-emerald-400/75">已持久化至服务端</span>
            </div>

            <!-- 正在查询中的状态 -->
            <div v-if="!discoveries[provider.id] && (busy || drawerLoading[provider.id])" class="py-8 text-center">
              <i class="fa-solid fa-circle-notch fa-spin text-lg text-primary mb-2"></i>
              <div class="text-xs font-medium text-text-secondary">
                {{ $t('agent.settings.providers.discoveringModels') }}
              </div>
            </div>

            <!-- 左右两栏策略布局：左侧【可添加模型】支持全选、多选、一键添加所有；右侧【已生效模型】支持单项及批量取消添加 -->
            <div v-else class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <!-- 左栏：可添加模型（支持多选、全选添加） -->
              <div class="flex flex-col rounded-xl border border-border/70 bg-card p-3 shadow-2xs">
                <div class="flex items-center justify-between gap-2 pb-2.5 border-b border-border/40">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-semibold text-foreground">{{
                      $t('agent.settings.providers.discoveredModels')
                    }}</span>
                    <span
                      class="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-mono text-primary font-medium"
                    >
                      {{ filteredAvailable(provider).length }}
                    </span>
                  </div>

                  <!-- 批量操作动作区 -->
                  <div class="flex items-center gap-1.5">
                    <!-- 多选添加按钮 -->
                    <button
                      v-if="selectedDiscoveredCount(provider) > 0"
                      type="button"
                      class="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-white shadow-2xs transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50 cursor-pointer"
                      :disabled="busy"
                      @click="addSelectedDiscovered(provider)"
                    >
                      <i class="fa-solid fa-plus text-[10px]"></i>
                      <span>{{
                        $t('agent.settings.providers.addSelected', { count: selectedDiscoveredCount(provider) })
                      }}</span>
                    </button>

                    <!-- 一键添加所有模型按钮 -->
                    <button
                      v-if="availableDiscoveries(provider).length > 0"
                      type="button"
                      class="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition-all cursor-pointer shadow-2xs"
                      :disabled="busy"
                      :title="$t('agent.settings.providers.addAllModels')"
                      @click="addAllDiscovered(provider)"
                    >
                      <i class="fa-solid fa-cloud-arrow-down text-xs"></i>
                      <span>{{ $t('agent.settings.providers.addAllModels') }}</span>
                    </button>
                  </div>
                </div>

                <!-- 搜索过滤与全选控制器 -->
                <div v-if="availableDiscoveries(provider).length > 0" class="flex items-center gap-2 py-2">
                  <label class="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none">
                    <input
                      type="checkbox"
                      class="rounded border-border/80 accent-primary cursor-pointer"
                      :checked="isAllDiscoveredSelected(provider)"
                      @change="toggleSelectAllDiscovered(provider)"
                    />
                    <span class="text-[11px]">{{
                      isAllDiscoveredSelected(provider)
                        ? $t('agent.settings.providers.deselectAll')
                        : $t('agent.settings.providers.selectAll')
                    }}</span>
                  </label>

                  <div class="relative flex-1">
                    <input
                      v-model="filterQueries[provider.id]"
                      type="text"
                      data-no-highlight
                      class="h-7 w-full rounded-lg border border-border/80 bg-background pl-6 pr-2 text-xs text-foreground placeholder:text-text-secondary/60 focus:border-border-hover focus:outline-none"
                      :placeholder="$t('agent.settings.providers.filterPlaceholder')"
                    />
                    <i
                      class="fa-solid fa-magnifying-glass absolute left-2 top-1/2 -translate-y-1/2 text-[9px] text-text-secondary/60"
                    ></i>
                  </div>
                </div>

                <!-- 模型列表项 -->
                <div
                  v-if="filteredAvailable(provider).length > 0"
                  class="max-h-56 overflow-y-auto space-y-1.5 pr-1 py-1"
                >
                  <div
                    v-for="model in filteredAvailable(provider)"
                    :key="model.id"
                    class="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-header/20 px-2.5 py-1.5 transition-all hover:bg-header/40"
                  >
                    <label class="flex items-center gap-2 min-w-0 cursor-pointer flex-1 select-none">
                      <input
                        type="checkbox"
                        class="rounded border-border/80 accent-primary cursor-pointer"
                        :checked="Boolean(selectedDiscovered[provider.id]?.[model.id])"
                        @change="toggleDiscoveredItem(provider, model.id)"
                      />
                      <span class="font-mono text-xs text-foreground truncate">{{ model.id }}</span>
                      <span
                        v-if="model.ownedBy"
                        class="rounded bg-header/60 px-1 py-0.2 font-mono text-[9px] text-text-secondary truncate"
                      >
                        {{ model.ownedBy }}
                      </span>
                    </label>

                    <button
                      type="button"
                      class="shrink-0 inline-flex items-center gap-1 rounded-md border border-border/70 bg-card px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:border-primary/50 hover:bg-primary/10 hover:text-primary transition-all cursor-pointer"
                      :disabled="busy"
                      @click="addSingleDiscovered(provider, model.id)"
                    >
                      <i class="fa-solid fa-plus text-[9px]"></i>
                      <span>{{ $t('agent.settings.providers.discoveryAdd') }}</span>
                    </button>
                  </div>
                </div>

                <div
                  v-else-if="availableDiscoveries(provider).length === 0"
                  class="py-6 text-center text-xs text-text-secondary"
                >
                  <div
                    class="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 mx-auto mb-1.5"
                  >
                    <i class="fa-solid fa-check text-xs"></i>
                  </div>
                  <p class="font-medium text-foreground">{{ $t('agent.settings.providers.allModelsConfigured') }}</p>
                </div>

                <div v-else class="py-6 text-center text-xs text-text-secondary">
                  {{ $t('agent.settings.providers.discoveryEmpty') }}
                </div>

                <!-- 底部极简手动增补条 -->
                <div class="mt-auto pt-2.5 border-t border-border/40">
                  <div class="flex items-center gap-1.5">
                    <input
                      v-model="manualModelId[provider.id]"
                      type="text"
                      data-no-highlight
                      class="h-7 flex-1 rounded-lg border border-border/80 bg-background px-2.5 text-xs text-foreground placeholder:text-text-secondary/60 focus:border-border-hover focus:outline-none"
                      :placeholder="$t('agent.settings.providers.manualAddPrompt')"
                      @keydown.enter.prevent="addManualModel(provider)"
                    />
                    <button
                      type="button"
                      class="h-7 rounded-lg bg-card border border-border/80 px-2.5 text-xs font-medium text-foreground hover:bg-header transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      :disabled="busy || !manualModelId[provider.id]?.trim()"
                      @click="addManualModel(provider)"
                    >
                      <i class="fa-solid fa-plus text-[10px] mr-1 text-primary"></i>
                      <span>{{ $t('agent.settings.providers.discoveryAdd') }}</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- 右栏：已生效模型（支持取消已添加、多选批量取消） -->
              <div class="flex flex-col rounded-xl border border-border/70 bg-card p-3 shadow-2xs">
                <div class="flex items-center justify-between gap-2 pb-2.5 border-b border-border/40">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-semibold text-foreground">{{
                      $t('agent.settings.providers.configuredModels')
                    }}</span>
                    <span
                      class="rounded-full bg-header px-1.5 py-0.2 text-[10px] font-mono text-text-secondary font-medium"
                    >
                      {{ provider.models.length }}
                    </span>
                  </div>

                  <!-- 批量操作区：全选、批量取消所选、一键移除 -->
                  <div class="flex items-center gap-1.5">
                    <!-- 全选/全不选可移除模型复选框 -->
                    <label
                      v-if="removableConfiguredModels(provider).length > 0"
                      class="flex items-center gap-1 text-xs text-text-secondary cursor-pointer select-none hover:text-foreground mr-1"
                    >
                      <input
                        type="checkbox"
                        class="rounded border-border/80 accent-error cursor-pointer"
                        :checked="isAllConfiguredSelected(provider)"
                        @change="toggleSelectAllConfigured(provider)"
                      />
                      <span>{{ $t('agent.settings.providers.selectAll') }}</span>
                    </label>

                    <!-- 批量取消已添加按钮 -->
                    <button
                      v-if="selectedConfiguredCount(provider) > 0"
                      type="button"
                      class="inline-flex items-center gap-1 rounded-lg border border-error/40 bg-error/10 px-2.5 py-1 text-xs font-semibold text-error hover:bg-error/20 transition-all cursor-pointer shadow-2xs"
                      :disabled="busy"
                      @click="removeSelectedConfigured(provider)"
                    >
                      <i class="fa-regular fa-trash-can text-[10px]"></i>
                      <span>{{
                        $t('agent.settings.providers.removeSelected', { count: selectedConfiguredCount(provider) })
                      }}</span>
                    </button>

                    <!-- 一键移除按钮 -->
                    <button
                      v-if="removableConfiguredModels(provider).length > 0"
                      type="button"
                      class="inline-flex items-center gap-1 rounded-lg border border-error/40 bg-error/10 px-2.5 py-1 text-xs font-semibold text-error hover:bg-error/20 transition-all cursor-pointer shadow-2xs"
                      :disabled="busy"
                      :title="$t('agent.settings.providers.removeAllModels')"
                      @click="removeAllConfigured(provider)"
                    >
                      <i class="fa-solid fa-trash-can text-xs"></i>
                      <span>{{ $t('agent.settings.providers.removeAllModels') }}</span>
                    </button>
                  </div>
                </div>

                <!-- 已生效模型列表 -->
                <div class="max-h-64 overflow-y-auto space-y-1.5 pr-1 py-2">
                  <div
                    v-for="model in provider.models"
                    :key="model.id"
                    class="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-header/20 px-2.5 py-1.5 transition-all hover:bg-header/40"
                  >
                    <label class="flex items-center gap-2 min-w-0 cursor-pointer flex-1 select-none">
                      <input
                        type="checkbox"
                        class="rounded border-border/80 accent-error cursor-pointer disabled:opacity-40"
                        :disabled="
                          provider.models.length <= 1 ||
                          (provider.id === defaultProviderId && model.id === defaultModelId)
                        "
                        :checked="Boolean(selectedConfigured[provider.id]?.[model.id])"
                        @change="toggleConfiguredItem(provider, model.id)"
                      />
                      <span class="font-mono text-xs text-foreground truncate">{{ model.id }}</span>
                      <span
                        v-if="provider.id === defaultProviderId && model.id === defaultModelId"
                        class="inline-flex items-center gap-1 rounded bg-primary/10 border border-primary/20 px-1.5 py-0.2 text-[9px] font-semibold text-primary"
                      >
                        <i class="fa-solid fa-star text-[7px]"></i>
                        <span>{{ $t('agent.settings.providers.defaultBadge') }}</span>
                      </span>
                    </label>

                    <!-- 单项取消添加 -->
                    <button
                      type="button"
                      class="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all select-none"
                      :class="
                        provider.models.length <= 1 ||
                        (provider.id === defaultProviderId && model.id === defaultModelId)
                          ? 'text-text-secondary/40 cursor-not-allowed'
                          : 'text-error hover:bg-error/10 cursor-pointer'
                      "
                      :disabled="
                        busy ||
                        provider.models.length <= 1 ||
                        (provider.id === defaultProviderId && model.id === defaultModelId)
                      "
                      :title="
                        provider.models.length <= 1
                          ? $t('agent.settings.providers.atLeastOneModel')
                          : provider.id === defaultProviderId && model.id === defaultModelId
                            ? $t('agent.settings.providers.cannotRemoveDefault')
                            : $t('agent.settings.providers.removeModel')
                      "
                      @click="removeConfiguredModel(provider, model.id)"
                    >
                      <i class="fa-regular fa-trash-can text-[10px]"></i>
                      <span>{{ $t('agent.settings.providers.removeModel') }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 抽屉底部操作条（即时持久化说明与收起/关闭动作） -->
            <div class="mt-3.5 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/50">
              <div class="flex items-center gap-1.5 text-xs text-text-secondary">
                <i class="fa-solid fa-cloud-check text-emerald-500 text-xs"></i>
                <span>{{ $t('agent.settings.providers.autoSaveHint') }}</span>
              </div>
              <button
                type="button"
                class="rounded-lg border border-border/80 bg-background px-4 py-1.8 text-xs font-medium text-text-secondary hover:bg-header hover:text-foreground shadow-2xs transition-all active:scale-95 cursor-pointer"
                @click="drawerOpen[provider.id] = false"
              >
                {{ $t('common.close') }}
              </button>
            </div>
          </div>
        </article>
      </div>

      <!-- 空态引导 -->
      <div v-else class="rounded-xl border border-dashed border-border/80 p-8 text-center bg-card/20">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <i class="fa-solid fa-wand-magic-sparkles text-xl"></i>
        </div>
        <div class="mt-3 text-sm font-semibold text-foreground">{{ $t('agent.settings.providers.empty') }}</div>
        <p class="mt-1 text-xs text-text-secondary max-w-sm mx-auto">
          {{ $t('agent.settings.providers.emptyHint') }}
        </p>
        <button
          type="button"
          class="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-primary/90 active:scale-95 cursor-pointer"
          @click="openAddModal"
        >
          <i class="fa-solid fa-plus text-xs"></i>
          <span>{{ $t('agent.settings.providers.add') }}</span>
        </button>
      </div>
    </div>
  </section>

  <!-- 添加 Provider 模态弹窗（彻底移除原生下拉，全面升级现代化分段器与预设高亮） -->
  <BaseModal
    :visible="modalOpen"
    :title="$t('agent.settings.providers.modalTitle')"
    :aria-label="$t('agent.settings.providers.modalTitle')"
    :close-on-backdrop="!modalTesting"
    :close-on-escape="!modalTesting"
    :focus-on-open="true"
    :restore-focus="true"
    panel-class="max-w-xl p-5 sm:p-6 rounded-2xl shadow-2xl border border-border/80 bg-card"
    @close="closeModal"
  >
    <div class="space-y-4">
      <p class="text-xs text-text-secondary leading-relaxed">
        {{ $t('agent.settings.providers.modalDescription') }}
      </p>

      <!-- 表单核心配置 -->
      <div class="space-y-3.5">
        <div class="grid grid-cols-1 gap-3">
          <!-- 显示名称 -->
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-foreground"
              >{{ $t('agent.settings.providers.name') }} <span class="text-error">*</span></span
            >
            <input
              v-model="form.displayName"
              required
              data-no-highlight
              class="h-9 w-full rounded-lg border border-border/80 bg-background px-3 text-xs text-foreground outline-none focus:border-border-hover"
              :placeholder="$t('agent.settings.providers.namePlaceholder')"
            />
          </label>
        </div>

        <!-- 接口 Base URL -->
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-foreground"
            >{{ $t('agent.settings.providers.baseUrl') }} <span class="text-error">*</span></span
          >
          <div class="relative flex items-center">
            <i class="fa-solid fa-link absolute left-3 text-text-secondary text-xs pointer-events-none"></i>
            <input
              v-model="form.baseUrl"
              required
              type="url"
              data-no-highlight
              class="h-9 w-full rounded-lg border border-border/80 bg-background pl-8 pr-3 font-mono text-xs text-foreground outline-none focus:border-border-hover"
              :placeholder="$t('agent.settings.providers.baseUrlPlaceholder')"
            />
          </div>
        </label>

        <!-- API Key 凭据 -->
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-foreground">{{
            $t('agent.settings.providers.credential')
          }}</span>
          <div class="relative flex items-center">
            <i class="fa-solid fa-key absolute left-3 text-text-secondary text-xs pointer-events-none"></i>
            <input
              v-model="form.credential"
              :type="showApiKey ? 'text' : 'password'"
              autocomplete="new-password"
              data-no-highlight
              class="h-9 w-full rounded-lg border border-border/80 bg-background pl-8 pr-9 font-mono text-xs text-foreground outline-none focus:border-border-hover"
              :placeholder="$t('agent.settings.providers.apiKeyPlaceholder')"
            />
            <button
              type="button"
              class="absolute right-2.5 text-text-secondary hover:text-foreground transition-colors cursor-pointer"
              @click="showApiKey = !showApiKey"
            >
              <i :class="showApiKey ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'" class="text-xs"></i>
            </button>
          </div>
        </label>

        <!-- 初始模型配置 -->
        <div class="rounded-xl border border-border/60 bg-header/15 p-3 space-y-2.5">
          <div class="text-[11px] font-semibold text-foreground flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <i class="fa-solid fa-cubes text-primary text-[10px]"></i>
              <span>{{ $t('agent.settings.providers.initialModel') }}</span>
            </span>
            <label class="inline-flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer select-none">
              <input v-model="form.supportsTools" type="checkbox" class="rounded accent-primary" />
              <span>{{ $t('agent.settings.providers.tools') }}</span>
            </label>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <label class="block">
              <span class="mb-1 block text-[10px] text-text-secondary"
                >{{ $t('agent.settings.providers.model') }} <span class="text-error">*</span></span
              >
              <input
                v-model="form.modelId"
                required
                data-no-highlight
                class="h-8.5 w-full rounded-lg border border-border/80 bg-background px-2.5 font-mono text-xs text-foreground outline-none focus:border-border-hover"
                :placeholder="$t('agent.settings.providers.modelPlaceholder')"
              />
            </label>

            <label class="block">
              <span class="mb-1 block text-[10px] text-text-secondary">{{
                $t('agent.settings.providers.contextWindow')
              }}</span>
              <input
                v-model.number="form.contextWindow"
                type="number"
                min="1"
                data-no-highlight
                class="h-8.5 w-full rounded-lg border border-border/80 bg-background px-2.5 font-mono text-xs text-foreground outline-none focus:border-border-hover"
              />
            </label>

            <label class="block">
              <span class="mb-1 block text-[10px] text-text-secondary">{{
                $t('agent.settings.providers.maxOutputTokens')
              }}</span>
              <input
                v-model.number="form.maxOutputTokens"
                type="number"
                min="1"
                data-no-highlight
                class="h-8.5 w-full rounded-lg border border-border/80 bg-background px-2.5 font-mono text-xs text-foreground outline-none focus:border-border-hover"
              />
            </label>
          </div>
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="modalError" class="rounded-lg border border-error/30 bg-error/10 p-2.5 text-xs text-error">
        {{ modalError }}
      </div>

      <!-- 测试结果反馈条 -->
      <div
        v-if="modalTestResult"
        class="rounded-xl border p-3 flex items-center justify-between gap-2 text-xs transition-all"
        :class="
          modalTestResult.ok
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'border-error/30 bg-error/10 text-error'
        "
      >
        <div class="flex items-center gap-2">
          <i :class="modalTestResult.ok ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'" class="text-sm"></i>
          <span class="font-medium">{{ modalTestResult.message }}</span>
        </div>
        <span v-if="modalTestResult.latencyMs" class="font-mono text-[11px]">
          响应延迟: {{ modalTestResult.latencyMs }}ms
        </span>
      </div>
    </div>

    <!-- 弹窗底部操作工具栏 -->
    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <!-- 左侧：模型测试按钮 -->
        <div>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3.5 py-1.8 text-xs font-semibold text-foreground shadow-2xs transition-all hover:bg-header hover:border-border active:scale-95 disabled:opacity-50 cursor-pointer"
            :disabled="modalTesting || busy || !form.displayName.trim() || !form.baseUrl.trim() || !form.modelId.trim()"
            @click="testInModal"
          >
            <i v-if="!modalTesting" class="fa-solid fa-vial text-primary text-xs" aria-hidden="true"></i>
            <i v-else class="fa-solid fa-circle-notch fa-spin text-primary text-xs" aria-hidden="true"></i>
            <span>{{
              modalTesting
                ? $t('agent.settings.providers.testingConnection')
                : $t('agent.settings.providers.testConnection')
            }}</span>
          </button>
        </div>

        <!-- 右侧：取消与确认保存 -->
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg border border-border/80 bg-background px-3.5 py-1.8 text-xs font-medium text-text-secondary hover:bg-header hover:text-foreground transition-all cursor-pointer"
            :disabled="modalTesting"
            @click="closeModal"
          >
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.8 text-xs font-semibold text-white shadow-sm transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50 cursor-pointer"
            :disabled="modalTesting || busy || !form.displayName.trim() || !form.baseUrl.trim() || !form.modelId.trim()"
            @click="submitModal"
          >
            <i v-if="createdProviderId" class="fa-solid fa-check text-xs"></i>
            <span>{{ createdProviderId ? $t('common.confirm') : $t('agent.settings.providers.saveAndAdd') }}</span>
          </button>
        </div>
      </div>
    </template>
  </BaseModal>

  <!-- 已配模型与连通测试模态弹窗 -->
  <BaseModal
    :visible="testModalOpen"
    :title="`${currentTestModalProvider?.displayName || ''} · ${$t('agent.settings.providers.testModalTitle')}`"
    :aria-label="$t('agent.settings.providers.testModalTitle')"
    :focus-on-open="true"
    panel-class="max-w-2xl p-5 sm:p-6 rounded-2xl shadow-2xl border border-border/80 bg-card"
    @close="testModalOpen = false"
  >
    <div v-if="currentTestModalProvider" class="space-y-4">
      <!-- 顶部概览与搜索栏 -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <div class="text-xs text-text-secondary">
            {{ $t('agent.settings.providers.testModalDesc') }}
          </div>
          <!-- 实时自动保存指示徽标 -->
          <span
            class="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
          >
            <i class="fa-solid fa-cloud-arrow-up text-[9px]"></i>
            <span>{{ $t('agent.settings.providers.autoSaved') }}</span>
          </span>
        </div>

        <!-- 搜索输入框 -->
        <div class="relative min-w-56">
          <input
            v-model="testModalSearch"
            type="text"
            data-no-highlight
            class="h-8 w-full rounded-lg border border-border/80 bg-background pl-7 pr-2.5 text-xs text-foreground placeholder:text-text-secondary/60 focus:border-border-hover focus:outline-none"
            :placeholder="$t('agent.settings.providers.searchConfiguredModels')"
          />
          <i
            class="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary/60"
          ></i>
        </div>
      </div>

      <!-- 弹窗即时保存闪现通知条 (Flash Notice) -->
      <div
        v-if="modalSaveNotice"
        class="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300 transition-all"
      >
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-circle-check text-emerald-500 text-xs"></i>
          <span class="font-medium">{{ modalSaveNotice }}</span>
        </div>
        <span class="text-[10px] text-emerald-600/75 dark:text-emerald-400/75">已同步持久化</span>
      </div>

      <!-- 模型列表卡片滚动区 -->
      <div class="max-h-[380px] overflow-y-auto space-y-2 pr-1">
        <div
          v-for="model in filteredTestModalModels"
          :key="model.id"
          class="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border/70 bg-header/20 p-3 text-xs transition-all hover:border-border/90 hover:bg-header/35"
        >
          <!-- 左侧信息 -->
          <div class="flex items-center gap-2.5 min-w-0">
            <div
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-card border border-border/60 text-foreground"
            >
              <i class="fa-solid fa-cube text-xs text-primary/80"></i>
            </div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-xs font-bold text-foreground truncate">{{ model.id }}</span>
                <span
                  v-if="currentTestModalProvider.id === defaultProviderId && model.id === defaultModelId"
                  class="inline-flex items-center gap-1 rounded-md bg-primary/10 border border-primary/20 px-1.5 py-0.2 text-[10px] font-semibold text-primary"
                >
                  <i class="fa-solid fa-star text-[8px]"></i>
                  <span>{{ $t('agent.settings.providers.defaultBadge') }}</span>
                </span>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-secondary">
                <span class="rounded bg-card border border-border/50 px-1.5 py-0.2 font-mono">
                  {{ compactTokens(model.contextWindow) }} 上下文
                </span>
                <span class="rounded bg-card border border-border/50 px-1.5 py-0.2 font-mono">
                  {{ compactTokens(model.maxOutputTokens) }} 输出
                </span>
                <span
                  v-if="model.supportsTools"
                  class="rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-1.5 py-0.2 font-medium"
                >
                  Tools
                </span>
                <span
                  v-if="model.reasoningEfforts?.length"
                  class="inline-flex items-center gap-1 rounded bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.2 font-medium"
                >
                  <i class="fa-solid fa-brain text-[8px]"></i>
                  <span>思考</span>
                </span>
              </div>
            </div>
          </div>

          <!-- 右侧操作与测试 -->
          <div class="flex items-center gap-2 shrink-0">
            <!-- 测试反馈微芯片 -->
            <span
              v-if="testResults[testKey(currentTestModalProvider, model.id)]"
              class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-mono font-medium"
              :class="
                testResults[testKey(currentTestModalProvider, model.id)]?.state === 'success'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                  : testResults[testKey(currentTestModalProvider, model.id)]?.state === 'error'
                    ? 'bg-error/10 text-error border border-error/20'
                    : 'bg-header text-text-secondary'
              "
            >
              <i
                :class="
                  testResults[testKey(currentTestModalProvider, model.id)]?.state === 'loading'
                    ? 'fa-solid fa-circle-notch fa-spin'
                    : testResults[testKey(currentTestModalProvider, model.id)]?.state === 'success'
                      ? 'fa-solid fa-check'
                      : 'fa-solid fa-circle-exclamation'
                "
                class="text-[9px]"
              ></i>
              <span>{{ testResults[testKey(currentTestModalProvider, model.id)]?.message }}</span>
            </span>

            <!-- 设为默认模型 -->
            <button
              v-if="!(currentTestModalProvider.id === defaultProviderId && model.id === defaultModelId)"
              type="button"
              class="rounded-lg border border-border/70 bg-card px-2.5 py-1 text-xs text-text-secondary hover:bg-header hover:text-foreground transition-all cursor-pointer shadow-2xs"
              :disabled="busy || !currentTestModalProvider.enabled"
              @click="emit('defaultModel', currentTestModalProvider.id, model.id)"
            >
              {{ $t('agent.settings.providers.setDefault') }}
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-header hover:text-foreground transition-all cursor-pointer shadow-2xs"
              :disabled="busy"
              @click="openCapabilityEditor(currentTestModalProvider, model)"
            >
              <i class="fa-solid fa-sliders text-[10px]" aria-hidden="true"></i>
              <span>{{ $t('agent.settings.providers.capabilityEdit') }}</span>
            </button>

            <!-- 快速测试连通性 -->
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition-all cursor-pointer disabled:opacity-50 shadow-2xs"
              :disabled="
                busy ||
                !currentTestModalProvider.enabled ||
                testResults[testKey(currentTestModalProvider, model.id)]?.state === 'loading'
              "
              @click="testModel(currentTestModalProvider, model.id)"
            >
              <i class="fa-solid fa-vial text-[10px]" aria-hidden="true"></i>
              <span>{{ $t('agent.settings.providers.test') }}</span>
            </button>

            <!-- 取消已添加模型 -->
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all select-none"
              :class="
                currentTestModalProvider.models.length <= 1 ||
                (currentTestModalProvider.id === defaultProviderId && model.id === defaultModelId)
                  ? 'border-border/40 bg-header/20 text-text-secondary/40 cursor-not-allowed'
                  : 'border-error/30 bg-error/5 text-error hover:bg-error/15 hover:border-error/50 cursor-pointer shadow-2xs'
              "
              :disabled="
                busy ||
                currentTestModalProvider.models.length <= 1 ||
                (currentTestModalProvider.id === defaultProviderId && model.id === defaultModelId)
              "
              :title="
                currentTestModalProvider.models.length <= 1
                  ? $t('agent.settings.providers.atLeastOneModel')
                  : currentTestModalProvider.id === defaultProviderId && model.id === defaultModelId
                    ? $t('agent.settings.providers.cannotRemoveDefault')
                    : $t('agent.settings.providers.removeModel')
              "
              @click="removeConfiguredModel(currentTestModalProvider, model.id)"
            >
              <i class="fa-regular fa-trash-can text-[10px]"></i>
              <span>{{ $t('agent.settings.providers.removeModel') }}</span>
            </button>
          </div>
        </div>

        <div v-if="filteredTestModalModels.length === 0" class="py-8 text-center text-xs text-text-secondary">
          未匹配到任何已配置模型
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <i class="fa-solid fa-cloud-check text-emerald-500 text-xs"></i>
          <span>{{ $t('agent.settings.providers.autoSaveHint') }}</span>
        </div>
        <button
          type="button"
          class="rounded-lg border border-border/80 bg-background px-4 py-1.8 text-xs font-medium text-text-secondary hover:bg-header hover:text-foreground shadow-2xs transition-all active:scale-95 cursor-pointer"
          @click="testModalOpen = false"
        >
          {{ $t('common.close') }}
        </button>
      </div>
    </template>
  </BaseModal>

  <BaseModal
    :visible="Boolean(capabilityEditor && capabilityEditorModel)"
    :title="$t('agent.settings.providers.capabilityTitle')"
    :aria-label="$t('agent.settings.providers.capabilityTitle')"
    :close-on-backdrop="!busy"
    :close-on-escape="!busy"
    :focus-on-open="true"
    panel-class="max-w-lg p-5 sm:p-6 rounded-2xl shadow-2xl border border-border/80 bg-card"
    @close="closeCapabilityEditor"
  >
    <div v-if="capabilityEditorModel" class="space-y-4">
      <div>
        <div class="font-mono text-sm font-semibold text-foreground">{{ capabilityEditorModel.id }}</div>
        <div class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.providers.capabilityDescription') }}</div>
      </div>

      <div class="space-y-3">
        <label class="block">
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-foreground">{{ $t('agent.settings.providers.contextWindow') }}</span>
            <div class="flex items-center gap-2 text-[10px]">
              <span :class="capabilityFieldIsDefault('contextWindow') ? 'text-primary' : 'text-text-secondary'">
                {{
                  capabilityFieldIsDefault('contextWindow')
                    ? $t('agent.settings.providers.registryDefault')
                    : $t('agent.settings.providers.manualOverride')
                }}
              </span>
              <button
                v-if="capabilityEditorModel.registryDefaults?.contextWindow !== undefined"
                type="button"
                class="text-primary hover:underline disabled:opacity-40"
                :disabled="capabilityFieldIsDefault('contextWindow')"
                @click="restoreCapabilityField('contextWindow')"
              >
                {{ $t('agent.settings.providers.restoreDefault') }}
              </button>
            </div>
          </div>
          <input
            v-model.number="capabilityForm.contextWindow"
            type="number"
            min="2"
            data-no-highlight
            class="h-9 w-full rounded-lg border border-border/80 bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-border-hover"
          />
        </label>

        <label class="block">
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-foreground">{{
              $t('agent.settings.providers.maxOutputTokens')
            }}</span>
            <div class="flex items-center gap-2 text-[10px]">
              <span :class="capabilityFieldIsDefault('maxOutputTokens') ? 'text-primary' : 'text-text-secondary'">
                {{
                  capabilityFieldIsDefault('maxOutputTokens')
                    ? $t('agent.settings.providers.registryDefault')
                    : $t('agent.settings.providers.manualOverride')
                }}
              </span>
              <button
                v-if="capabilityEditorModel.registryDefaults?.maxOutputTokens !== undefined"
                type="button"
                class="text-primary hover:underline disabled:opacity-40"
                :disabled="capabilityFieldIsDefault('maxOutputTokens')"
                @click="restoreCapabilityField('maxOutputTokens')"
              >
                {{ $t('agent.settings.providers.restoreDefault') }}
              </button>
            </div>
          </div>
          <input
            v-model.number="capabilityForm.maxOutputTokens"
            type="number"
            min="1"
            data-no-highlight
            class="h-9 w-full rounded-lg border border-border/80 bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-border-hover"
          />
        </label>

        <div class="rounded-lg border border-border/70 bg-header/20 px-3 py-2.5">
          <div class="flex items-center justify-between gap-3">
            <label class="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
              <input v-model="capabilityForm.supportsTools" type="checkbox" class="rounded accent-primary" />
              <span>{{ $t('agent.settings.providers.tools') }}</span>
            </label>
            <div class="flex items-center gap-2 text-[10px]">
              <span :class="capabilityFieldIsDefault('supportsTools') ? 'text-primary' : 'text-text-secondary'">
                {{
                  capabilityFieldIsDefault('supportsTools')
                    ? $t('agent.settings.providers.registryDefault')
                    : $t('agent.settings.providers.manualOverride')
                }}
              </span>
              <button
                v-if="capabilityEditorModel.registryDefaults?.supportsTools !== undefined"
                type="button"
                class="text-primary hover:underline disabled:opacity-40"
                :disabled="capabilityFieldIsDefault('supportsTools')"
                @click="restoreCapabilityField('supportsTools')"
              >
                {{ $t('agent.settings.providers.restoreDefault') }}
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="capabilityEditorModel.reasoningEfforts?.length"
          class="rounded-lg border border-border/70 bg-header/20 px-3 py-2.5 text-xs"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium text-foreground">{{ $t('agent.settings.providers.reasoningCapability') }}</span>
            <span class="text-[10px] text-primary">{{ $t('agent.settings.providers.registryManaged') }}</span>
          </div>
          <div class="mt-1 font-mono text-[11px] text-text-secondary">
            {{ capabilityEditorModel.reasoningEfforts.join(' · ') }}
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <button
          v-if="capabilityEditorModel?.registryDefaults"
          type="button"
          class="rounded-lg border border-border/80 bg-background px-3 py-1.5 text-xs font-medium text-primary hover:bg-header disabled:opacity-50"
          :disabled="busy"
          @click="restoreAllCapabilities"
        >
          {{ $t('agent.settings.providers.restoreAllDefaults') }}
        </button>
        <span v-else></span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg border border-border/80 bg-background px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-header"
            :disabled="busy"
            @click="closeCapabilityEditor"
          >
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            :disabled="busy"
            @click="saveCapabilities"
          >
            {{ $t('common.save') }}
          </button>
        </div>
      </div>
    </template>
  </BaseModal>
</template>
