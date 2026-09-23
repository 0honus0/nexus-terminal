<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    BaseModal,
    UiButton,
    UiCheckbox,
    UiEmptyState,
    UiInfoHint,
    UiPopover,
    UiSelect,
    type UiSelectOption,
  } from '@/foundation/ui';
  import { useOperationFeedback } from '@/shared/feedback/public';
  import ModelCapabilityEditor from './ModelCapabilityEditor.vue';
  import {
    agentApi,
    formatAgentApiError,
    type AgentDiscoveredProviderModelDto,
    type AgentModelRegistryStatusDto,
    type AgentProviderCreateRequestDto,
    type AgentProviderModelInputDto,
    type AgentProviderViewDto,
    type AgentModelCapabilityDefaultsDto,
  } from '../api/agent-api';

  const props = defineProps<{
    addProviderModel: (
      provider: AgentProviderViewDto,
      model: AgentProviderViewDto['models'][number],
      successMsg?: string,
    ) => Promise<boolean | undefined>;
    updateProviderModels?: (
      provider: AgentProviderViewDto,
      models: AgentProviderViewDto['models'],
      successMsg?: string,
    ) => Promise<boolean | undefined>;
    createProvider: (
      input: AgentProviderCreateRequestDto,
      successMsg?: string,
    ) => Promise<AgentProviderViewDto | undefined>;
    providers: AgentProviderViewDto[];
    busy: boolean;
    discoveries: Record<string, AgentDiscoveredProviderModelDto[]>;
    defaultProviderId: string | null;
    defaultModelId: string | null;
    fallbackModels: Array<{ providerId: string; modelId: string }>;
  }>();

  const emit = defineEmits<{
    toggle: [provider: AgentProviderViewDto, enabled: boolean];
    protocol: [provider: AgentProviderViewDto, protocol: AgentProviderViewDto['protocol']];
    discover: [provider: AgentProviderViewDto];
    defaultModel: [providerId: string, modelId: string];
    fallbackModels: [models: Array<{ providerId: string; modelId: string }>];
    delete: [provider: AgentProviderViewDto];
  }>();

  const { t } = useI18n();
  const operationFeedback = useOperationFeedback('agent.settings.providers');

  // 添加服务商弹窗状态与表单
  const modalOpen = ref(false);
  const modalTesting = ref(false);
  const modalError = ref('');
  const modalTestResult = ref<{ ok: boolean; latencyMs?: number; message?: string } | null>(null);
  const createdProviderId = ref<string | null>(null);
  const showApiKey = ref(false);
  const copiedUrl = ref<string | null>(null);
  const modelRegistryStatus = ref<AgentModelRegistryStatusDto | null>(null);
  const modelRegistryBusy = ref(false);

  const loadModelRegistryStatus = async (): Promise<void> => {
    try {
      modelRegistryStatus.value = await agentApi.modelRegistryStatus();
    } catch {
      // Supplemental status only; provider management still works with the built-in snapshot.
    }
  };

  const refreshModelRegistry = async (): Promise<void> => {
    if (modelRegistryBusy.value) return;
    modelRegistryBusy.value = true;
    try {
      modelRegistryStatus.value = await agentApi.refreshModelRegistry();
      operationFeedback.notifySuccess(t('agent.settings.providers.registryUpdated'));
    } catch (cause) {
      operationFeedback.notifyError({
        operation: 'refresh-model-registry',
        message: formatAgentApiError(cause, t('agent.settings.providers.registryUpdateFailed')),
        cause,
      });
      await loadModelRegistryStatus();
    } finally {
      modelRegistryBusy.value = false;
    }
  };

  const setModelRegistryAutoUpdate = async (enabled: boolean): Promise<void> => {
    if (modelRegistryBusy.value) return;
    modelRegistryBusy.value = true;
    try {
      modelRegistryStatus.value = await agentApi.setModelRegistryAutoUpdate(enabled);
    } catch (cause) {
      operationFeedback.notifyError({
        operation: 'set-model-registry-auto-update',
        message: formatAgentApiError(cause, t('agent.ui.saveFailed')),
        cause,
      });
      await loadModelRegistryStatus();
    } finally {
      modelRegistryBusy.value = false;
    }
  };

  const formatRegistryDate = (value: number): string => new Date(value * 1000).toLocaleDateString();

  // 模型库同步抽屉与批量策略状态
  const drawerOpen = reactive<Record<string, boolean>>({});
  const drawerLoading = reactive<Record<string, boolean>>({});
  const filterQueries = reactive<Record<string, string>>({});
  const filterConfiguredQueries = reactive<Record<string, string>>({});

  const filteredConfigured = (provider: AgentProviderViewDto) => {
    const query = (filterConfiguredQueries[provider.id] || '').trim().toLowerCase();
    if (!query) return provider.models;
    return provider.models.filter((m) => m.id.toLowerCase().includes(query));
  };
  const selectedDiscovered = reactive<Record<string, Record<string, boolean>>>({});
  const manualModelId = reactive<Record<string, string>>({});
  const isSavingModels = reactive<Record<string, boolean>>({});

  // 删除确认
  const deletingProvider = ref<AgentProviderViewDto | null>(null);
  const confirmingRemoveAll = ref<AgentProviderViewDto | null>(null);

  // 已配置模型与连通测试模态弹窗状态
  const testModalOpen = ref(false);
  const testModalTargetProvider = ref<AgentProviderViewDto | null>(null);
  const testModalSearch = ref('');

  const openTestModal = (provider: AgentProviderViewDto) => {
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

  const protocolFromValue = (value: unknown): AgentProviderViewDto['protocol'] =>
    value === 'responses' ? 'responses' : 'chat-completions';

  const protocolOptions = computed<UiSelectOption[]>(() => [
    { value: 'chat-completions', label: t('agent.settings.providers.protocolChat') },
    { value: 'responses', label: t('agent.settings.providers.protocolResponses') },
  ]);

  const form = reactive({
    displayName: '',
    baseUrl: '',
    protocol: 'chat-completions' as AgentProviderViewDto['protocol'],
    credential: '',
    modelId: '',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  });

  const isPullingModels = ref(false);
  const pulledModels = ref<AgentDiscoveredProviderModelDto[]>([]);
  const selectedPulledModelKey = ref<string | null>(null);
  const importAllPulled = ref(false);

  const openAddModal = () => {
    form.displayName = '';
    form.baseUrl = '';
    form.protocol = 'chat-completions';
    form.credential = '';
    form.modelId = '';
    form.contextWindow = 128000;
    form.maxOutputTokens = 4096;
    form.supportsTools = true;
    form.supportsImageInput = false;
    form.supportsFileInput = false;
    isPullingModels.value = false;
    pulledModels.value = [];
    selectedPulledModelKey.value = null;
    importAllPulled.value = false;
    modalError.value = '';
    modalTestResult.value = null;
    createdProviderId.value = null;
    showApiKey.value = false;
    modalOpen.value = true;
  };

  const applyPulledModel = (model: AgentDiscoveredProviderModelDto) => {
    selectedPulledModelKey.value = model.id;
    form.modelId = model.id;
    const defaults = model.registryDefaults;
    const caps = model.providerCapabilities?.capabilities;
    form.contextWindow = caps?.contextWindow ?? defaults?.contextWindow ?? 128000;
    form.maxOutputTokens = caps?.maxOutputTokens ?? defaults?.maxOutputTokens ?? 4096;
    form.supportsTools = caps?.supportsTools ?? defaults?.supportsTools ?? true;
    form.supportsImageInput = caps?.supportsImageInput ?? defaults?.supportsImageInput ?? false;
    form.supportsFileInput = caps?.supportsFileInput ?? defaults?.supportsFileInput ?? false;
  };

  const pullModelsFromEndpoint = async () => {
    if (!form.baseUrl.trim()) {
      modalError.value = t('agent.settings.providers.fieldRequired', { field: t('agent.settings.providers.baseUrl') });
      return;
    }
    modalError.value = '';
    isPullingModels.value = true;
    try {
      const list = await agentApi.discoverEndpointModels({
        baseUrl: form.baseUrl.trim(),
        credential: form.credential.trim() || undefined,
      });
      pulledModels.value = list;
      if (list.length > 0) {
        operationFeedback.notifySuccess(t('agent.settings.providers.pullSuccess', { count: list.length }));
        const match = list.find((m) => m.id === form.modelId.trim()) ?? list[0];
        applyPulledModel(match);
      } else {
        operationFeedback.notifyInfo(t('agent.settings.providers.discoveryEmpty'));
      }
    } catch (cause) {
      const errMsg = formatAgentApiError(cause, t('agent.settings.providers.pullFailed'));
      modalError.value = errMsg;
      operationFeedback.notifyError({ operation: 'pull-models', message: errMsg, cause });
    } finally {
      isPullingModels.value = false;
    }
  };

  const onSelectPulledModel = (value: unknown) => {
    const found = pulledModels.value.find((m) => m.id === value);
    if (found) applyPulledModel(found);
  };

  const pulledModelOptions = computed<UiSelectOption[]>(() =>
    pulledModels.value.map((m) => ({
      value: m.id,
      label: m.id,
      description: m.ownedBy ? `owned by ${m.ownedBy}` : undefined,
    })),
  );

  const closeModal = () => {
    if (modalTesting.value) return;
    modalOpen.value = false;
  };

  // 测试结果缓存
  const testResults = reactive<Record<string, { state: 'loading' | 'success' | 'error'; message: string }>>({});
  const testKey = (provider: AgentProviderViewDto, modelId: string) =>
    JSON.stringify([provider.id, provider.version, modelId]);

  const testModel = async (provider: AgentProviderViewDto, modelId: string) => {
    const key = testKey(provider, modelId);
    if (testResults[key]?.state === 'loading') return;
    testResults[key] = { state: 'loading', message: t('agent.ui.testing') };
    try {
      const result = await agentApi.testProvider(provider.id, modelId);
      if (result.ok) {
        const latencyText = `${result.latencyMs}ms`;
        testResults[key] = { state: 'success', message: latencyText };
        operationFeedback.notifySuccess(
          `${provider.displayName} · ${modelId}: ${t('agent.settings.providers.testPassed')} (${latencyText})`,
        );
      } else {
        testResults[key] = { state: 'error', message: t('agent.ui.testFailed') };
        operationFeedback.notifyError({
          operation: 'test-model',
          message: `${provider.displayName} · ${modelId}: ${t('agent.settings.providers.testFailedMessage')}`,
          context: { providerId: provider.id, modelId },
        });
      }
    } catch (cause) {
      const errMsg = formatAgentApiError(cause, t('agent.ui.testFailed'));
      testResults[key] = { state: 'error', message: errMsg };
      operationFeedback.notifyError({
        operation: 'test-model',
        message: `${provider.displayName} · ${modelId}: ${errMsg}`,
        cause,
        context: { providerId: provider.id, modelId },
      });
    }
  };

  // 弹窗内的连通性测试
  const testInModal = async () => {
    modalError.value = '';
    modalTestResult.value = null;

    if (!form.displayName.trim()) {
      modalError.value = t('agent.settings.providers.fieldRequired', { field: t('agent.settings.providers.name') });
      return;
    }
    if (!form.baseUrl.trim()) {
      modalError.value = t('agent.settings.providers.fieldRequired', { field: t('agent.settings.providers.baseUrl') });
      return;
    }
    if (!form.modelId.trim()) {
      modalError.value = t('agent.settings.providers.fieldRequired', { field: t('agent.settings.providers.model') });
      return;
    }

    modalTesting.value = true;
    try {
      let targetProviderId = createdProviderId.value;

      // 如果尚未保存，先通过 createProvider 建立服务商记录
      if (!targetProviderId) {
        const modelsToCreate: AgentProviderModelInputDto[] =
          importAllPulled.value && pulledModels.value.length > 0
            ? pulledModels.value.map((m) => {
                const defaults = m.registryDefaults;
                const caps = m.providerCapabilities?.capabilities;
                return {
                  id: m.id,
                  contextWindow: caps?.contextWindow ?? defaults?.contextWindow ?? 128000,
                  maxOutputTokens: caps?.maxOutputTokens ?? defaults?.maxOutputTokens ?? 4096,
                  supportsTools: caps?.supportsTools ?? defaults?.supportsTools ?? true,
                  supportsImageInput: caps?.supportsImageInput ?? defaults?.supportsImageInput ?? false,
                  supportsFileInput: caps?.supportsFileInput ?? defaults?.supportsFileInput ?? false,
                };
              })
            : [
                {
                  id: form.modelId.trim(),
                  contextWindow: form.contextWindow,
                  maxOutputTokens: form.maxOutputTokens,
                  supportsTools: form.supportsTools,
                  supportsImageInput: form.supportsImageInput,
                  supportsFileInput: form.supportsFileInput,
                },
              ];

        const payload: AgentProviderCreateRequestDto = {
          kind: 'openai-compatible',
          displayName: form.displayName.trim(),
          baseUrl: form.baseUrl.trim(),
          protocol: form.protocol,
          ...(form.credential.trim() ? { credential: form.credential.trim() } : {}),
          models: modelsToCreate,
          enabled: true,
        };

        const saved = await props.createProvider(payload);
        if (!saved) return;

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
          operationFeedback.notifySuccess(`${form.displayName.trim() || form.modelId.trim()}: ${successMsg}`);
        } else {
          const failMsg = t('agent.settings.providers.testFailedMessage');
          modalTestResult.value = {
            ok: false,
            message: failMsg,
          };
          operationFeedback.notifyError({
            operation: 'test-new-provider',
            message: `${form.displayName.trim() || form.modelId.trim()}: ${failMsg}`,
            context: { modelId: form.modelId.trim() },
          });
        }
      }
    } catch (cause) {
      const errMsg = formatAgentApiError(cause, t('agent.settings.providers.testFailedMessage'));
      modalTestResult.value = {
        ok: false,
        message: errMsg,
      };
      operationFeedback.notifyError({ operation: 'test-new-provider', message: errMsg, cause });
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
      modalError.value = t('agent.settings.providers.completeRequired');
      return;
    }

    modalTesting.value = true;
    try {
      const modelsToCreate: AgentProviderModelInputDto[] =
        importAllPulled.value && pulledModels.value.length > 0
          ? pulledModels.value.map((m) => {
              const defaults = m.registryDefaults;
              const caps = m.providerCapabilities?.capabilities;
              return {
                id: m.id,
                contextWindow: caps?.contextWindow ?? defaults?.contextWindow ?? 128000,
                maxOutputTokens: caps?.maxOutputTokens ?? defaults?.maxOutputTokens ?? 4096,
                supportsTools: caps?.supportsTools ?? defaults?.supportsTools ?? true,
                supportsImageInput: caps?.supportsImageInput ?? defaults?.supportsImageInput ?? false,
                supportsFileInput: caps?.supportsFileInput ?? defaults?.supportsFileInput ?? false,
              };
            })
          : [
              {
                id: form.modelId.trim(),
                contextWindow: form.contextWindow,
                maxOutputTokens: form.maxOutputTokens,
                supportsTools: form.supportsTools,
                supportsImageInput: form.supportsImageInput,
                supportsFileInput: form.supportsFileInput,
              },
            ];

      const payload: AgentProviderCreateRequestDto = {
        kind: 'openai-compatible',
        displayName: form.displayName.trim(),
        baseUrl: form.baseUrl.trim(),
        protocol: form.protocol,
        ...(form.credential.trim() ? { credential: form.credential.trim() } : {}),
        models: modelsToCreate,
        enabled: true,
      };

      const saved = await props.createProvider(payload);
      if (saved) {
        modalOpen.value = false;
      }
    } catch (cause) {
      operationFeedback.notifyError({
        operation: 'create-provider',
        message: formatAgentApiError(cause, t('agent.ui.createFailed')),
        cause,
      });
    } finally {
      modalTesting.value = false;
    }
  };

  // 触发更新模型并打开抽屉
  const triggerDiscover = (provider: AgentProviderViewDto) => {
    drawerOpen[provider.id] = true;
    drawerLoading[provider.id] = true;
    emit('discover', provider);
    setTimeout(() => {
      drawerLoading[provider.id] = false;
    }, 1500);
  };

  const toggleDrawer = (provider: AgentProviderViewDto) => {
    if (drawerOpen[provider.id]) {
      drawerOpen[provider.id] = false;
    } else {
      triggerDiscover(provider);
    }
  };

  // 可添加（未配置）的发现模型列表
  const availableDiscoveries = (provider: AgentProviderViewDto): AgentDiscoveredProviderModelDto[] => {
    const configured = new Set(provider.models.map((m) => m.id));
    return (props.discoveries[provider.id] ?? []).filter((m) => !configured.has(m.id));
  };

  // 过滤后的可添加列表
  const filteredAvailable = (provider: AgentProviderViewDto): AgentDiscoveredProviderModelDto[] => {
    const query = (filterQueries[provider.id] || '').trim().toLowerCase();
    const all = availableDiscoveries(provider);
    if (!query) return all;
    return all.filter(
      (m) => m.id.toLowerCase().includes(query) || (m.ownedBy && m.ownedBy.toLowerCase().includes(query)),
    );
  };

  // 选中的可添加模型数量
  const selectedDiscoveredCount = (provider: AgentProviderViewDto): number => {
    const map = selectedDiscovered[provider.id] || {};
    return filteredAvailable(provider).filter((m) => map[m.id]).length;
  };

  // 全选/取消全选可添加模型
  const isAllDiscoveredSelected = (provider: AgentProviderViewDto): boolean => {
    const list = filteredAvailable(provider);
    if (!list.length) return false;
    const map = selectedDiscovered[provider.id] || {};
    return list.every((m) => map[m.id]);
  };

  const toggleSelectAllDiscovered = (provider: AgentProviderViewDto) => {
    const list = filteredAvailable(provider);
    if (!list.length) return;
    const allSelected = isAllDiscoveredSelected(provider);
    if (!selectedDiscovered[provider.id]) selectedDiscovered[provider.id] = {};
    for (const m of list) {
      selectedDiscovered[provider.id][m.id] = !allSelected;
    }
  };

  const toggleDiscoveredItem = (provider: AgentProviderViewDto, modelId: string) => {
    if (!selectedDiscovered[provider.id]) selectedDiscovered[provider.id] = {};
    selectedDiscovered[provider.id][modelId] = !selectedDiscovered[provider.id][modelId];
  };

  // 统一更新方法
  const updateModels = async (
    provider: AgentProviderViewDto,
    models: AgentProviderViewDto['models'],
    successMsg?: string,
  ): Promise<boolean> => {
    if (props.updateProviderModels) {
      const ok = await props.updateProviderModels(provider, models, successMsg);
      return Boolean(ok);
    }
    try {
      await agentApi.updateProvider(provider, { models });
      operationFeedback.notifySuccess(successMsg ?? t('agent.ui.saved'));
      return true;
    } catch (cause) {
      const errMsg = formatAgentApiError(cause, t('agent.ui.createFailed'));
      operationFeedback.notifyError({
        operation: 'update-provider-models',
        message: errMsg,
        cause,
        context: { providerId: provider.id },
      });
      return false;
    }
  };

  const discoveredModelConfig = (
    provider: AgentProviderViewDto,
    modelId: string,
    registryFallback?: AgentModelCapabilityDefaultsDto | null,
    allowIncomplete = false,
  ): AgentProviderViewDto['models'][number] | null => {
    const discovered = (props.discoveries[provider.id] ?? []).find((model) => model.id === modelId);
    const registry = discovered?.registryDefaults ?? registryFallback ?? undefined;
    const providerObservation = discovered?.providerCapabilities;
    const live = providerObservation?.capabilities;
    const contextWindow = live?.contextWindow ?? registry?.contextWindow;
    const maxOutputTokens = live?.maxOutputTokens ?? registry?.maxOutputTokens;
    const supportsTools = live?.supportsTools ?? registry?.supportsTools;
    if (
      !allowIncomplete &&
      (contextWindow === undefined || maxOutputTokens === undefined || supportsTools === undefined)
    ) {
      return null;
    }

    const sourceFor = (
      field: 'contextWindow' | 'maxOutputTokens' | 'supportsTools' | 'supportsImageInput' | 'supportsFileInput',
    ): 'provider' | 'registry' | 'manual' =>
      live?.[field] !== undefined ? 'provider' : registry?.[field] !== undefined ? 'registry' : 'manual';
    const reasoning = live?.reasoning ?? registry?.reasoning;
    const reasoningSource = live?.reasoning
      ? ('provider' as const)
      : registry?.reasoning
        ? ('registry' as const)
        : undefined;

    return {
      id: modelId,
      contextWindow: contextWindow ?? 0,
      maxOutputTokens: maxOutputTokens ?? 0,
      supportsTools: supportsTools ?? false,
      supportsImageInput: live?.supportsImageInput ?? registry?.supportsImageInput ?? false,
      supportsFileInput: live?.supportsFileInput ?? registry?.supportsFileInput ?? false,
      capabilitySources: {
        contextWindow: sourceFor('contextWindow'),
        maxOutputTokens: sourceFor('maxOutputTokens'),
        supportsTools: sourceFor('supportsTools'),
        supportsImageInput: sourceFor('supportsImageInput'),
        supportsFileInput: sourceFor('supportsFileInput'),
        ...(reasoningSource ? { reasoning: reasoningSource } : {}),
      },
      ...(registry ? { registryDefaults: registry } : {}),
      ...(providerObservation ? { providerCapabilities: providerObservation } : {}),
      ...(reasoning
        ? {
            reasoningEfforts: [...reasoning.supportedEfforts],
            ...(reasoning.defaultEffort === undefined ? {} : { defaultReasoningEffort: reasoning.defaultEffort }),
            ...(reasoningSource ? { reasoningSource } : {}),
            ...(reasoning.mandatory === undefined ? {} : { reasoningMandatory: reasoning.mandatory }),
          }
        : {}),
    };
  };

  const resolveRegistryDefaults = async (modelId: string): Promise<AgentModelCapabilityDefaultsDto | null> => {
    try {
      return (await agentApi.resolveModelRegistry(modelId)).defaults;
    } catch {
      return null;
    }
  };

  const capabilityEditor = ref<{
    providerId: string;
    modelId: string;
    mode: 'edit' | 'add';
    draft?: AgentProviderViewDto['models'][number];
  } | null>(null);
  const capabilityEditorProvider = computed(() =>
    capabilityEditor.value
      ? (props.providers.find((provider) => provider.id === capabilityEditor.value?.providerId) ?? null)
      : null,
  );
  const capabilityEditorModel = computed(() => {
    if (!capabilityEditorProvider.value || !capabilityEditor.value) return null;
    if (capabilityEditor.value.mode === 'add') return capabilityEditor.value.draft ?? null;
    return capabilityEditorProvider.value.models.find((model) => model.id === capabilityEditor.value?.modelId) ?? null;
  });

  const openCapabilityEditor = (
    provider: AgentProviderViewDto,
    model: AgentProviderViewDto['models'][number],
  ): void => {
    capabilityEditor.value = { providerId: provider.id, modelId: model.id, mode: 'edit' };
  };

  const openCapabilityEditorForAdd = async (provider: AgentProviderViewDto, modelId: string): Promise<void> => {
    const registry = await resolveRegistryDefaults(modelId);
    const draft = discoveredModelConfig(provider, modelId, registry, true);
    if (!draft) return;
    capabilityEditor.value = { providerId: provider.id, modelId, mode: 'add', draft };
  };

  const closeCapabilityEditor = (): void => {
    if (props.busy) return;
    capabilityEditor.value = null;
  };

  const saveCapabilities = async (model: AgentProviderViewDto['models'][number]): Promise<void> => {
    const provider = capabilityEditorProvider.value;
    const editor = capabilityEditor.value;
    if (!provider || !editor) return;
    const next =
      editor.mode === 'add'
        ? [...provider.models, model]
        : provider.models.map((candidate) => (candidate.id === model.id ? model : candidate));
    const saved = await updateModels(
      provider,
      next,
      editor.mode === 'add'
        ? t('agent.settings.providers.saveNoticeAdded', { count: 1 })
        : t('agent.settings.providers.capabilitySaved'),
    );
    if (!saved) return;
    if (editor.mode === 'add') {
      if (manualModelId[provider.id] === model.id) manualModelId[provider.id] = '';
      if (selectedDiscovered[provider.id]) delete selectedDiscovered[provider.id][model.id];
    }
    capabilityEditor.value = null;
  };

  // 一键添加所有支持模型
  const addAllDiscovered = async (provider: AgentProviderViewDto): Promise<void> => {
    const available = availableDiscoveries(provider);
    if (!available.length) return;
    isSavingModels[provider.id] = true;
    try {
      const resolvedModels = available.map((model) => discoveredModelConfig(provider, model.id));
      const newModels = resolvedModels.filter(
        (model): model is AgentProviderViewDto['models'][number] => model !== null,
      );
      if (newModels.length > 0) {
        const noticeAdded = t('agent.settings.providers.saveNoticeAdded', { count: newModels.length });
        const saved = await updateModels(provider, [...provider.models, ...newModels], noticeAdded);
        if (!saved) return;
        selectedDiscovered[provider.id] = {};
      }
      const needsReview = resolvedModels.length - newModels.length;
      if (needsReview > 0) {
        operationFeedback.notifyError({
          operation: 'resolve-model-capabilities',
          message: t('agent.settings.providers.capabilityNeedsReview', { count: needsReview }),
          context: { providerId: provider.id },
        });
      }
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 多选添加所选模型
  const addSelectedDiscovered = async (provider: AgentProviderViewDto): Promise<void> => {
    const map = selectedDiscovered[provider.id] || {};
    const selectedIds = Object.keys(map).filter((id) => map[id]);
    if (!selectedIds.length) return;
    isSavingModels[provider.id] = true;
    try {
      const resolvedModels = selectedIds.map((id) => discoveredModelConfig(provider, id));
      const newModels = resolvedModels.filter(
        (model): model is AgentProviderViewDto['models'][number] => model !== null,
      );
      if (newModels.length > 0) {
        const noticeSelected = t('agent.settings.providers.saveNoticeAdded', { count: newModels.length });
        const saved = await updateModels(provider, [...provider.models, ...newModels], noticeSelected);
        if (!saved) return;
        selectedDiscovered[provider.id] = {};
      }
      const needsReview = resolvedModels.length - newModels.length;
      if (needsReview > 0) {
        operationFeedback.notifyError({
          operation: 'resolve-model-capabilities',
          message: t('agent.settings.providers.capabilityNeedsReview', { count: needsReview }),
          context: { providerId: provider.id },
        });
      }
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 单项快捷添加
  const addSingleDiscovered = async (provider: AgentProviderViewDto, modelId: string): Promise<void> => {
    isSavingModels[provider.id] = true;
    try {
      let newModel = discoveredModelConfig(provider, modelId);
      if (!newModel) {
        const registry = await resolveRegistryDefaults(modelId);
        newModel = discoveredModelConfig(provider, modelId, registry);
      }
      if (!newModel) {
        await openCapabilityEditorForAdd(provider, modelId);
        return;
      }
      const noticeSingle = t('agent.settings.providers.saveNoticeAdded', { count: 1 });
      const saved = await updateModels(provider, [...provider.models, newModel], noticeSingle);
      if (!saved) return;
      if (selectedDiscovered[provider.id]) {
        delete selectedDiscovered[provider.id][modelId];
      }
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 取消已添加（单项）
  const removeFallbackModels = (providerId: string, modelIds: ReadonlySet<string>): void => {
    const next = props.fallbackModels.filter(
      (fallback) => fallback.providerId !== providerId || !modelIds.has(fallback.modelId),
    );
    if (next.length !== props.fallbackModels.length) emit('fallbackModels', next);
  };

  const removeConfiguredModel = async (provider: AgentProviderViewDto, modelId: string): Promise<void> => {
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
      removeFallbackModels(provider.id, new Set([modelId]));
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 获取服务商中所有可安全移除的模型（必须保留至少一个核心模型：优先保留系统默认模型，否则保留首个模型）
  const removableConfiguredModels = (provider: AgentProviderViewDto): AgentProviderViewDto['models'] => {
    if (provider.models.length <= 1) return [];
    const isDefaultProvider = props.defaultProviderId === provider.id;
    const hasDefaultModel = provider.models.some((m) => m.id === props.defaultModelId);
    const keepModelId = isDefaultProvider && hasDefaultModel ? props.defaultModelId : provider.models[0]?.id;
    return provider.models.filter((m) => m.id !== keepModelId);
  };

  // 一键移除所有可删除模型（保留默认主力模型或首个基础模型）
  const removeAllConfigured = async (provider: AgentProviderViewDto): Promise<void> => {
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
      removeFallbackModels(provider.id, removableIds);
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 手动输入添加
  const addManualModel = async (provider: AgentProviderViewDto): Promise<void> => {
    const id = (manualModelId[provider.id] || '').trim();
    if (!id) return;
    if (provider.models.some((m) => m.id === id)) {
      manualModelId[provider.id] = '';
      return;
    }
    isSavingModels[provider.id] = true;
    try {
      let newModel = discoveredModelConfig(provider, id);
      if (!newModel) {
        const registry = await resolveRegistryDefaults(id);
        newModel = discoveredModelConfig(provider, id, registry);
      }
      if (!newModel) {
        await openCapabilityEditorForAdd(provider, id);
        return;
      }
      const noticeManual = t('agent.settings.providers.saveNoticeAdded', { count: 1 });
      const saved = await updateModels(provider, [...provider.models, newModel], noticeManual);
      if (!saved) return;
      manualModelId[provider.id] = '';
    } finally {
      isSavingModels[provider.id] = false;
    }
  };

  // 默认模型选择：统一 Select 下拉（禁用自由输入），模型 ID 为主、渠道为次
  const defaultModelSelectOptions = computed<UiSelectOption[]>(() =>
    modelOptions.value.map((opt) => ({
      value: opt.key,
      label: opt.model.id,
      description: opt.provider.displayName,
    })),
  );

  const selectDefaultModel = (value: unknown) => {
    const opt = modelOptions.value.find((item) => item.key === value);
    if (opt) emit('defaultModel', opt.provider.id, opt.model.id);
  };

  onMounted(() => {
    void loadModelRegistryStatus();
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

  const MAX_FALLBACK_MODELS = 8;

  const defaultModelKey = computed(() =>
    props.defaultProviderId && props.defaultModelId ? `${props.defaultProviderId}\u0000${props.defaultModelId}` : '',
  );

  const validFallbackModels = computed(() => {
    const configuredKeys = new Set(modelOptions.value.map((item) => item.key));
    return props.fallbackModels.filter(
      (item) =>
        configuredKeys.has(`${item.providerId}\u0000${item.modelId}`) &&
        `${item.providerId}\u0000${item.modelId}` !== defaultModelKey.value,
    );
  });

  // 已选备用模型行：附带 provider/model 详情，供有序列表渲染
  const selectedFallbackRows = computed(() =>
    validFallbackModels.value.map((item) => {
      const key = `${item.providerId}\u0000${item.modelId}`;
      const option = modelOptions.value.find((candidate) => candidate.key === key) ?? null;
      return { key, providerId: item.providerId, modelId: item.modelId, option };
    }),
  );

  const fallbackModelKeys = computed(() => new Set(selectedFallbackRows.value.map((row) => row.key)));

  // 添加备用模型弹层：只列出已启用、非默认且未选中的候选项
  const fallbackDropdownOpen = ref(false);
  const fallbackSearch = ref('');

  const fallbackOptions = computed(() =>
    modelOptions.value.filter((item) => item.key !== defaultModelKey.value && !fallbackModelKeys.value.has(item.key)),
  );

  const filteredFallbackOptions = computed(() => {
    const q = fallbackSearch.value.trim().toLowerCase();
    if (!q) return fallbackOptions.value;
    return fallbackOptions.value.filter(
      (opt) => opt.model.id.toLowerCase().includes(q) || opt.provider.displayName.toLowerCase().includes(q),
    );
  });

  const fallbackAtCapacity = computed(() => validFallbackModels.value.length >= MAX_FALLBACK_MODELS);

  const handleFallbackPopoverChange = (_open: boolean) => {
    fallbackSearch.value = '';
  };

  const addFallbackModel = (providerId: string, modelId: string) => {
    const key = `${providerId}\u0000${modelId}`;
    if (fallbackAtCapacity.value || fallbackModelKeys.value.has(key)) return;
    emit('fallbackModels', [...validFallbackModels.value, { providerId, modelId }]);
    fallbackDropdownOpen.value = false;
    fallbackSearch.value = '';
  };

  const removeFallbackModel = (key: string) => {
    emit(
      'fallbackModels',
      validFallbackModels.value.filter((item) => `${item.providerId}\u0000${item.modelId}` !== key),
    );
  };

  const moveFallbackModel = (index: number, delta: number) => {
    const current = validFallbackModels.value;
    const target = index + delta;
    if (target < 0 || target >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    emit('fallbackModels', next);
  };

  const modelCount = computed(() => props.providers.reduce((total, p) => total + p.models.length, 0));

  const compactTokens = (value: number): string => {
    if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}m`;
    if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
    return String(value);
  };

  const copyText = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      copiedUrl.value = text;
      operationFeedback.notifySuccess(t("agent.settings.providers.copyUrlSuccess"));
      setTimeout(() => {
        if (copiedUrl.value === text) {
          copiedUrl.value = null;
        }
      }, 1500);
    } catch {
      operationFeedback.notifyError({
        operation: "copy-url",
        message: t("agent.operations.requestFailed"),
      });
    }
  };

  const providerIcon = (provider: AgentProviderViewDto): string => {
    const name = provider.displayName.toLowerCase();
    const url = provider.baseUrl.toLowerCase();
    if (name.includes('openai') || url.includes('openai')) return 'fa-solid fa-bolt text-success';
    if (name.includes('deepseek') || url.includes('deepseek')) return 'fa-solid fa-wand-magic-sparkles text-primary';
    if (name.includes('moonshot') || name.includes('kimi') || url.includes('moonshot'))
      return 'fa-solid fa-moon text-primary';
    if (name.includes('ollama') || url.includes('localhost') || url.includes('127.0.0.1'))
      return 'fa-solid fa-server text-warning';
    if (name.includes('silicon') || url.includes('siliconflow')) return 'fa-solid fa-microchip text-primary';
    return 'fa-solid fa-cube text-text-secondary';
  };

  const confirmRemoveAll = async (): Promise<void> => {
    const provider = confirmingRemoveAll.value;
    if (!provider) return;
    confirmingRemoveAll.value = null;
    await removeAllConfigured(provider);
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
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/35 px-4 py-3 sm:px-5 sm:py-3.5 rounded-t-2xl agent-settings-head"
    >
      <div>
        <div class="flex items-center gap-2.5">
          <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.providers.title') }}</h3>
          <span
            class="rounded-full border border-border/70 bg-background/80 px-2.5 py-0.5 text-[11px] font-medium text-text-secondary"
          >
            {{ $t('agent.settings.providers.counts', { providers: providers.length, models: modelCount }) }}
          </span>
          <UiInfoHint :text="$t('agent.settings.providers.description')" />
        </div>
      </div>

      <!-- 添加服务商主按钮 -->
      <UiButton appearance="solid" tone="primary" type="button" :disabled="busy" @click="openAddModal">
        <i class="fa-solid fa-plus text-xs" aria-hidden="true"></i>
        <span>{{ $t('agent.settings.providers.add') }}</span>
      </UiButton>
    </div>

    <div class="space-y-4 p-4 sm:p-5">
      <div
        v-if="modelRegistryStatus"
        class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-header/30 px-3 py-2 text-[11px]"
      >
        <div class="flex flex-wrap items-center gap-2 text-text-secondary">
          <span class="font-medium text-foreground">{{ $t('agent.settings.providers.registryTitle') }}</span>
          <span>{{ modelRegistryStatus.entryCount }} {{ $t('agent.settings.providers.registryModels') }}</span>
          <span>·</span>
          <span>{{ formatRegistryDate(modelRegistryStatus.generatedAt) }}</span>
          <span
            v-if="modelRegistryStatus.lastErrorCode"
            class="rounded bg-error/10 px-1.5 py-0.5 font-mono text-[11px] text-error"
          >
            {{ modelRegistryStatus.lastErrorCode }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-1.5 text-text-secondary">
            <UiCheckbox
              :model-value="modelRegistryStatus.autoUpdate"
              :disabled="modelRegistryBusy"
              @update:model-value="setModelRegistryAutoUpdate"
            />
            <span>{{ $t('agent.settings.providers.registryAutoUpdate') }}</span>
          </label>
          <UiButton
            appearance="soft"
            tone="neutral"
            type="button"
            :disabled="modelRegistryBusy"
            @click="refreshModelRegistry"
          >
            <i
              class="fa-solid fa-arrows-rotate text-[9px]"
              :class="{ 'fa-spin': modelRegistryBusy }"
              aria-hidden="true"
            ></i>
            <span>{{ $t('agent.settings.providers.registryRefresh') }}</span>
          </UiButton>
        </div>
      </div>

      <!-- 默认模型选择微岛（现代定制无原生边框） -->
      <div
        class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg bg-header/30 p-3.5 transition-all relative z-10"
      >
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <i class="fa-solid fa-robot text-sm" aria-hidden="true"></i>
          </div>
          <div class="flex items-center gap-2">
            <div class="text-xs font-semibold text-foreground">{{ $t('agent.settings.providers.defaultModel') }}</div>
            <span
              class="inline-flex items-center gap-1 rounded-full bg-success/10 border border-success/25 px-2 py-0.5 text-[11px] font-medium text-success"
            >
              <i class="fa-solid fa-cloud-arrow-up text-[8px]"></i>
              <span>{{ $t('agent.settings.providers.autoSaved') }}</span>
            </span>
          </div>
        </div>

        <div class="min-w-64 max-w-sm">
          <UiSelect
            :model-value="defaultModelKey || null"
            :options="defaultModelSelectOptions"
            :disabled="busy || modelOptions.length === 0"
            :placeholder="$t('agent.settings.providers.chooseDefault')"
            :aria-label="$t('agent.settings.providers.defaultModel')"
            align="end"
            density="comfortable"
            panel-class="max-h-72"
            @update:model-value="selectDefaultModel"
          />
        </div>
      </div>

      <div class="rounded-lg bg-header/25 p-3.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <div class="text-xs font-semibold text-foreground">
              {{ $t('agent.settings.providers.fallbackTitle') }}
            </div>
            <span
              class="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-text-secondary"
            >
              {{
                $t('agent.settings.providers.fallbackCount', {
                  count: selectedFallbackRows.length,
                  max: MAX_FALLBACK_MODELS,
                })
              }}
            </span>
          </div>

          <!-- 添加备用模型：复用 Gen2 UiPopover，仅列出可加入的候选项 -->
          <UiPopover
            v-model:open="fallbackDropdownOpen"
            :disabled="busy || fallbackAtCapacity || fallbackOptions.length === 0"
            :ariaLabel="$t('agent.settings.providers.fallbackAdd')"
            align="end"
            placement="bottom"
            :offset="6"
            panel-class="w-[min(360px,calc(100vw-24px))] p-1.5"
            @open-change="handleFallbackPopoverChange"
          >
            <template #trigger="{ open }">
              <span class="inline-flex items-center gap-1.5 text-xs">
                <i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
                <span>{{ $t('agent.settings.providers.fallbackAdd') }}</span>
                <i
                  class="fa-solid fa-chevron-down text-[10px] transition-transform duration-200"
                  :class="{ 'rotate-180': open }"
                ></i>
              </span>
            </template>

            <template #panel>
              <!-- 搜索框（候选项多于 3 个时显示） -->
              <div v-if="fallbackOptions.length > 3" class="relative mb-1.5 px-1 pt-1">
                <i
                  class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary/70 pointer-events-none"
                ></i>
                <input
                  v-model="fallbackSearch"
                  type="text"
                  data-no-highlight
                  class="h-7.5 w-full rounded-lg border border-border/70 bg-header/30 pl-7 pr-2.5 text-xs text-foreground placeholder:text-text-secondary/60 outline-none focus:border-border-hover"
                  :placeholder="$t('agent.settings.providers.fallbackSearchPlaceholder')"
                  @click.stop
                />
              </div>

              <!-- 候选模型滚动列表 -->
              <div class="max-h-60 overflow-y-auto space-y-1 pr-0.5">
                <button
                  v-for="option in filteredFallbackOptions"
                  :key="option.key"
                  type="button"
                  class="flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-foreground transition-all cursor-pointer hover:bg-header/60"
                  @click="addFallbackModel(option.provider.id, option.model.id)"
                >
                  <div class="flex items-center gap-2 min-w-0 flex-1">
                    <i :class="providerIcon(option.provider)" class="text-xs shrink-0"></i>
                    <span class="font-mono text-xs font-medium truncate">{{ option.model.id }}</span>
                  </div>
                  <span
                    class="shrink-0 rounded-md border border-border/60 bg-header/40 px-1.5 py-0.5 text-[11px] text-text-secondary leading-none"
                  >
                    {{ option.provider.displayName }}
                  </span>
                </button>

                <div v-if="filteredFallbackOptions.length === 0" class="py-4 text-center text-xs text-text-secondary">
                  {{ $t('agent.settings.providers.noMatchingModels') }}
                </div>
              </div>
            </template>
          </UiPopover>
        </div>

        <!-- 已选备用模型：显式有序列表（1..N + 上移/下移/移除） -->
        <ol v-if="selectedFallbackRows.length > 0" class="mt-3 space-y-1.5">
          <li
            v-for="(row, index) in selectedFallbackRows"
            :key="row.key"
            class="flex items-center gap-2.5 rounded-lg bg-header/25 px-3 py-2"
          >
            <span
              class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary"
            >
              {{ index + 1 }}
            </span>
            <i v-if="row.option" :class="providerIcon(row.option.provider)" class="text-xs shrink-0"></i>
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <span class="font-mono text-xs font-semibold text-foreground truncate">{{ row.modelId }}</span>
              <span
                v-if="row.option"
                class="shrink-0 rounded-md border border-border/60 bg-header/40 px-1.5 py-0.5 text-[11px] text-text-secondary leading-none"
              >
                {{ row.option.provider.displayName }}
              </span>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <UiButton
                appearance="ghost"
                tone="neutral"
                icon-only
                density="compact"
                type="button"
                :disabled="busy || index === 0"
                :aria-label="$t('agent.settings.providers.fallbackMoveUp')"
                :title="$t('agent.settings.providers.fallbackMoveUp')"
                @click="moveFallbackModel(index, -1)"
              >
                <i class="fa-solid fa-arrow-up text-[10px]" aria-hidden="true"></i>
              </UiButton>
              <UiButton
                appearance="ghost"
                tone="neutral"
                icon-only
                density="compact"
                type="button"
                :disabled="busy || index === selectedFallbackRows.length - 1"
                :aria-label="$t('agent.settings.providers.fallbackMoveDown')"
                :title="$t('agent.settings.providers.fallbackMoveDown')"
                @click="moveFallbackModel(index, 1)"
              >
                <i class="fa-solid fa-arrow-down text-[10px]" aria-hidden="true"></i>
              </UiButton>
              <UiButton
                appearance="ghost"
                tone="danger"
                icon-only
                density="compact"
                type="button"
                :disabled="busy"
                :aria-label="$t('agent.settings.providers.fallbackRemove')"
                :title="$t('agent.settings.providers.fallbackRemove')"
                @click="removeFallbackModel(row.key)"
              >
                <i class="fa-solid fa-xmark text-[10px]" aria-hidden="true"></i>
              </UiButton>
            </div>
          </li>
        </ol>

        <!-- 空态：紧凑信息提示，而非按钮云 -->
        <div
          v-else
          class="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-border/70 bg-background/40 px-3 py-2.5 text-[11px] text-text-secondary"
        >
          <i class="fa-solid fa-layer-group text-text-secondary/80" aria-hidden="true"></i>
          <span>{{ $t('agent.settings.providers.fallbackEmpty') }}</span>
        </div>
      </div>

      <!-- 服务商列表（简炼高质感堆叠卡片） -->
      <div v-if="providers.length > 0" class="space-y-3">
        <article
          v-for="provider in providers"
          :key="provider.id"
          data-testid="agent-provider-card"
          :data-provider-id="provider.id"
          class="rounded-xl border border-border/85 bg-card/60 transition-all hover:border-border hover:bg-card/85 shadow-2xs overflow-hidden"
        >
          <!-- 服务商顶行摘要（紧凑单行） -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 px-3.5 py-2">
            <!-- 左侧核心身份与配置元数据（单行紧凑排布：名称 + 协议下拉） -->
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary"
              >
                <i :class="providerIcon(provider)" class="text-xs"></i>
              </div>
              <div class="flex flex-wrap items-center gap-2.5 min-w-0 flex-1">
                <!-- 服务商名称（带清晰边界与复制反馈，点击复制 Base URL） -->
                <button
                  type="button"
                  class="group inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold tracking-tight transition-all cursor-pointer select-none shrink-0 shadow-xs"
                  :class="
                    copiedUrl === provider.baseUrl
                      ? 'border-success/70 bg-success/15 text-success'
                      : 'border-border/90 bg-background/90 hover:bg-card text-foreground hover:border-primary/60 hover:text-primary'
                  "
                  :title="
                    copiedUrl === provider.baseUrl
                      ? $t('agent.settings.providers.copyUrlSuccess')
                      : `${provider.baseUrl} · ${$t('agent.settings.providers.copyUrl')}`
                  "
                  @click="copyText(provider.baseUrl)"
                >
                  <span>{{ provider.displayName }}</span>
                  <span
                    v-if="copiedUrl === provider.baseUrl"
                    class="text-[11px] font-medium inline-flex items-center gap-1 text-success"
                  >
                    <i class="fa-solid fa-check text-[10px]" aria-hidden="true"></i>
                    <span>{{ $t('agent.settings.providers.copyUrlSuccess') }}</span>
                  </span>
                  <i
                    v-else
                    class="fa-regular fa-copy text-[10px] text-text-secondary/50 group-hover:text-primary transition-colors"
                    aria-hidden="true"
                  ></i>
                </button>

                <!-- 协议选择器（按最长文本展示，紧凑不占过多空间） -->
                <div class="w-[130px] shrink-0">
                  <UiSelect
                    density="compact"
                    :hide-indicator="true"
                    panel-class="!min-w-[130px]"
                    class="w-full text-[11px]"
                    :aria-label="$t('agent.settings.providers.protocol')"
                    :disabled="busy"
                    :model-value="provider.protocol"
                    :options="protocolOptions"
                    @update:model-value="(value: unknown) => emit('protocol', provider, protocolFromValue(value))"
                  />
                </div>
              </div>
            </div>

            <!-- 右侧操作工具条：模型与测试(仅图标) + 更新模型(仅图标) + 启动(绿色)/停用(红色) + 删除(仅图标) -->
            <div
              class="flex items-center justify-end gap-1.5 shrink-0 pt-2 sm:pt-0 border-t border-border/30 sm:border-0"
            >
              <!-- 模型与测试（仅图标） -->
              <UiButton
                appearance="soft"
                tone="neutral"
                density="compact"
                icon-only
                type="button"
                :title="$t('agent.settings.providers.testModalBtn', { count: provider.models.length })"
                :aria-label="$t('agent.settings.providers.testModalBtn', { count: provider.models.length })"
                :disabled="busy"
                @click="openTestModal(provider)"
              >
                <i class="fa-solid fa-vial text-xs text-primary" aria-hidden="true"></i>
              </UiButton>

              <!-- 更新模型（抽屉式同步，仅图标） -->
              <UiButton
                type="button"
                appearance="soft"
                density="compact"
                icon-only
                :tone="drawerOpen[provider.id] ? 'primary' : 'neutral'"
                :title="$t('agent.settings.providers.discover')"
                :aria-label="$t('agent.settings.providers.discover')"
                :disabled="busy"
                @click="toggleDrawer(provider)"
              >
                <i
                  class="fa-solid fa-arrows-rotate text-xs"
                  :class="{ 'fa-spin': busy || drawerLoading[provider.id] }"
                  aria-hidden="true"
                ></i>
              </UiButton>

              <!-- 启停状态切换：启动(绿色) / 停用(红色) -->
              <UiButton
                type="button"
                appearance="soft"
                density="compact"
                :tone="provider.enabled ? 'danger' : 'success'"
                :disabled="busy"
                class="text-xs font-medium"
                :title="
                  provider.enabled ? $t('agent.settings.providers.disable') : $t('agent.settings.providers.enable')
                "
                @click="emit('toggle', provider, !provider.enabled)"
              >
                {{ provider.enabled ? $t('agent.settings.providers.disable') : $t('agent.settings.providers.enable') }}
              </UiButton>

              <!-- 删除服务商（仅图标） -->
              <UiButton
                type="button"
                appearance="ghost"
                tone="danger"
                icon-only
                density="compact"
                :title="$t('agent.settings.providers.deleteConfirm')"
                :aria-label="$t('agent.settings.providers.deleteConfirm')"
                :disabled="busy"
                @click="deletingProvider = provider"
              >
                <i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
              </UiButton>
            </div>
          </div>

          <!-- 更新模型抽屉区（高质感多选、全选、一键添加与取消已添加） -->
          <div
            v-if="drawerOpen[provider.id]"
            class="border-t border-border/50 bg-header/15 p-3.5 sm:p-4 transition-all"
          >
            <!-- 正在查询中的状态 -->
            <div v-if="!discoveries[provider.id] && (busy || drawerLoading[provider.id])" class="py-8 text-center">
              <i class="fa-solid fa-circle-notch fa-spin text-lg text-primary mb-2"></i>
              <div class="text-xs font-medium text-text-secondary">
                {{ $t('agent.settings.providers.discoveringModels') }}
              </div>
            </div>

            <!-- 左右两栏策略布局：左侧【可添加模型】支持全选、多选、一键添加所有；右侧【已生效模型】支持单项及批量取消添加 -->
            <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-stretch">
              <!-- 左栏：可添加模型（支持多选、全选添加） -->
              <div class="flex flex-col rounded-xl border border-border/70 bg-card p-3 shadow-2xs h-full">
                <!-- 顶栏标题与批量动作（统一高度 min-h-8 pb-2.5） -->
                <div class="flex items-center justify-between gap-2 min-h-8 pb-2.5 border-b border-border/40">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-semibold text-foreground">{{
                      $t('agent.settings.providers.discoveredModels')
                    }}</span>
                    <span
                      class="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-mono text-primary font-medium"
                    >
                      {{ filteredAvailable(provider).length }}
                    </span>
                  </div>

                  <!-- 批量操作动作区 -->
                  <div class="flex items-center gap-1.5">
                    <!-- 多选添加按钮 -->
                    <UiButton
                      appearance="solid"
                      tone="primary"
                      density="compact"
                      v-if="selectedDiscoveredCount(provider) > 0"
                      type="button"
                      :disabled="busy"
                      @click="addSelectedDiscovered(provider)"
                    >
                      <i class="fa-solid fa-plus text-[10px]"></i>
                      <span>{{
                        $t('agent.settings.providers.addSelected', { count: selectedDiscoveredCount(provider) })
                      }}</span>
                    </UiButton>

                    <!-- 一键添加所有模型按钮 -->
                    <UiButton
                      appearance="soft"
                      tone="neutral"
                      density="compact"
                      v-if="availableDiscoveries(provider).length > 0"
                      type="button"
                      :disabled="busy"
                      :title="$t('agent.settings.providers.addAllModels')"
                      @click="addAllDiscovered(provider)"
                    >
                      <i class="fa-solid fa-cloud-arrow-down text-xs"></i>
                      <span>{{ $t('agent.settings.providers.addAllModels') }}</span>
                    </UiButton>
                  </div>
                </div>

                <!-- 搜索过滤与全选控制器（统一固定高度 h-9 my-1） -->
                <div class="flex items-center gap-2 h-9 my-1">
                  <label
                    v-if="availableDiscoveries(provider).length > 0"
                    class="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none shrink-0"
                  >
                    <UiCheckbox
                      :model-value="isAllDiscoveredSelected(provider)"
                      @update:model-value="toggleSelectAllDiscovered(provider)"
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

                <!-- 模型列表项（固定 h-60 滚动区域） -->
                <div v-if="filteredAvailable(provider).length > 0" class="h-60 overflow-y-auto space-y-1.5 pr-1 py-1">
                  <div
                    v-for="model in filteredAvailable(provider)"
                    :key="model.id"
                    class="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-header/20 px-2.5 py-1.5 transition-all hover:bg-header/40"
                  >
                    <label class="flex items-center gap-2 min-w-0 cursor-pointer flex-1 select-none">
                      <UiCheckbox
                        :model-value="Boolean(selectedDiscovered[provider.id]?.[model.id])"
                        @update:model-value="toggleDiscoveredItem(provider, model.id)"
                      />
                      <span class="font-mono text-xs text-foreground truncate">{{ model.id }}</span>
                      <span
                        v-if="model.ownedBy"
                        class="rounded bg-header/60 px-1 py-0.5 font-mono text-[11px] text-text-secondary truncate"
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
                  class="h-60 flex flex-col items-center justify-center text-center text-xs text-text-secondary"
                >
                  <div
                    class="flex h-8 w-8 items-center justify-center rounded-full bg-success/10 text-success mx-auto mb-1.5"
                  >
                    <i class="fa-solid fa-check text-xs"></i>
                  </div>
                  <p class="font-medium text-foreground">{{ $t('agent.settings.providers.allModelsConfigured') }}</p>
                </div>

                <div v-else class="h-60 flex items-center justify-center text-center text-xs text-text-secondary">
                  {{ $t('agent.settings.providers.discoveryEmpty') }}
                </div>

                <!-- 底部极简手动增补条（统一高度 h-8 pt-2.5） -->
                <div class="mt-auto pt-2.5 border-t border-border/40">
                  <div class="flex items-center gap-1.5 h-8">
                    <input
                      v-model="manualModelId[provider.id]"
                      type="text"
                      data-no-highlight
                      class="h-7 flex-1 rounded-lg border border-border/80 bg-background px-2.5 text-xs text-foreground placeholder:text-text-secondary/60 focus:border-border-hover focus:outline-none"
                      :placeholder="$t('agent.settings.providers.manualAddPrompt')"
                      @keydown.enter.prevent="addManualModel(provider)"
                    />
                    <UiButton
                      appearance="soft"
                      tone="neutral"
                      density="compact"
                      type="button"
                      :disabled="busy || !manualModelId[provider.id]?.trim()"
                      @click="addManualModel(provider)"
                    >
                      <i class="fa-solid fa-plus text-[10px] mr-1 text-primary"></i>
                      <span>{{ $t('agent.settings.providers.discoveryAdd') }}</span>
                    </UiButton>
                  </div>
                </div>
              </div>

              <!-- 右栏：已生效模型（支持取消已添加、多选批量取消） -->
              <div class="flex flex-col rounded-xl border border-border/70 bg-card p-3 shadow-2xs h-full">
                <!-- 顶栏标题与批量动作（统一高度 min-h-8 pb-2.5） -->
                <div class="flex items-center justify-between gap-2 min-h-8 pb-2.5 border-b border-border/40">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-semibold text-foreground">{{
                      $t('agent.settings.providers.configuredModels')
                    }}</span>
                    <span
                      class="rounded-full bg-header px-1.5 py-0.5 text-[11px] font-mono text-text-secondary font-medium"
                    >
                      {{ provider.models.length }}
                    </span>
                  </div>

                  <!-- 已生效模型只保留一个批量取消入口，单项仍可在列表中逐个取消 -->
                  <div class="flex items-center gap-1.5">
                    <UiButton
                      appearance="soft"
                      tone="danger"
                      density="compact"
                      v-if="removableConfiguredModels(provider).length > 0"
                      type="button"
                      data-testid="configured-models-remove-all"
                      :disabled="busy"
                      :title="$t('agent.settings.providers.removeAllModels')"
                      @click="confirmingRemoveAll = provider"
                    >
                      <i class="fa-solid fa-trash-can text-xs"></i>
                      <span>{{ $t('agent.settings.providers.removeAllModels') }}</span>
                    </UiButton>
                  </div>
                </div>

                <!-- 搜索过滤栏（统一固定高度 h-9 my-1） -->
                <div class="flex items-center gap-2 h-9 my-1">
                  <div class="relative flex-1">
                    <input
                      v-model="filterConfiguredQueries[provider.id]"
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

                <!-- 已生效模型列表（固定 h-60 滚动区域） -->
                <div class="h-60 overflow-y-auto space-y-1.5 pr-1 py-1">
                  <div
                    v-for="model in filteredConfigured(provider)"
                    :key="model.id"
                    class="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-header/20 px-2.5 py-1.5 transition-all hover:bg-header/40"
                  >
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                      <span class="font-mono text-xs text-foreground truncate">{{ model.id }}</span>
                      <span
                        v-if="provider.id === defaultProviderId && model.id === defaultModelId"
                        class="inline-flex items-center gap-1 rounded bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[11px] font-semibold text-primary"
                      >
                        <i class="fa-solid fa-star text-[7px]"></i>
                        <span>{{ $t('agent.settings.providers.defaultBadge') }}</span>
                      </span>
                    </div>

                    <!-- 单项取消添加 -->
                    <UiButton
                      class="shrink-0"
                      appearance="soft"
                      density="compact"
                      :tone="
                        provider.models.length <= 1 ||
                        (provider.id === defaultProviderId && model.id === defaultModelId)
                          ? 'neutral'
                          : 'danger'
                      "
                      type="button"
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
                      <i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
                      <span>{{ $t('agent.settings.providers.removeModel') }}</span>
                    </UiButton>
                  </div>

                  <div
                    v-if="filteredConfigured(provider).length === 0"
                    class="h-full flex items-center justify-center text-center text-xs text-text-secondary"
                  >
                    {{ $t('agent.settings.providers.noMatchingModel') }}
                  </div>
                </div>

                <!-- 底部辅助信息条（统一高度 h-8 pt-2.5） -->
                <div class="mt-auto pt-2.5 border-t border-border/40">
                  <div class="flex items-center justify-between gap-2 h-8 text-xs text-text-secondary px-0.5">
                    <span class="inline-flex items-center gap-1.5 truncate text-[11px]">
                      <i class="fa-solid fa-star text-[10px] text-primary" aria-hidden="true"></i>
                      <span>{{ $t('agent.settings.providers.defaultModel') }}:</span>
                      <span class="font-mono font-medium text-foreground truncate">{{
                        defaultModelId || provider.models[0]?.id
                      }}</span>
                    </span>
                    <span class="shrink-0 text-[11px] font-mono text-text-secondary/80">
                      {{ $t('agent.settings.providers.configuredModels') }} {{ provider.models.length }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 抽屉底部操作条（即时持久化说明） -->
            <div class="mt-3.5 flex items-center justify-between gap-3 pt-3 border-t border-border/50">
              <div class="flex items-center gap-1.5 text-xs text-text-secondary">
                <i class="fa-solid fa-cloud-check text-success text-xs"></i>
                <span>{{ $t('agent.settings.providers.autoSaveHint') }}</span>
              </div>
            </div>
          </div>
        </article>
      </div>

      <!-- 空态引导 -->
      <UiEmptyState
        v-else
        icon="fa-solid fa-wand-magic-sparkles"
        :title="$t('agent.settings.providers.empty')"
        :description="$t('agent.settings.providers.emptyHint')"
      >
        <template #action>
          <UiButton appearance="solid" tone="primary" type="button" @click="openAddModal">
            <i class="fa-solid fa-plus text-xs" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.providers.add') }}</span>
          </UiButton>
        </template>
      </UiEmptyState>
    </div>
  </section>

  <BaseModal
    :visible="Boolean(confirmingRemoveAll)"
    :title="$t('agent.settings.providers.removeAllModelsConfirmTitle')"
    :aria-label="$t('agent.settings.providers.removeAllModelsConfirmTitle')"
    :focus-on-open="true"
    :restore-focus="true"
    panel-class="max-w-md p-5 sm:p-6 rounded-2xl shadow-2xl border border-border/80 bg-card"
    @close="confirmingRemoveAll = null"
  >
    <p class="text-sm leading-6 text-text-secondary">
      {{
        $t('agent.settings.providers.removeAllModelsConfirmPrompt', {
          count: confirmingRemoveAll ? removableConfiguredModels(confirmingRemoveAll).length : 0,
          name: confirmingRemoveAll?.displayName || '',
        })
      }}
    </p>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UiButton appearance="soft" tone="neutral" type="button" :disabled="busy" @click="confirmingRemoveAll = null">
          {{ $t('common.cancel') }}
        </UiButton>
        <UiButton appearance="solid" tone="danger" type="button" :disabled="busy" @click="confirmRemoveAll">
          {{ $t('agent.settings.providers.removeAllModels') }}
        </UiButton>
      </div>
    </template>
  </BaseModal>

  <BaseModal
    :visible="Boolean(deletingProvider)"
    :title="$t('agent.settings.providers.deleteConfirm')"
    :aria-label="$t('agent.settings.providers.deleteConfirm')"
    :focus-on-open="true"
    :restore-focus="true"
    panel-class="max-w-md p-5 sm:p-6 rounded-2xl shadow-2xl border border-border/80 bg-card"
    @close="deletingProvider = null"
  >
    <p class="text-sm leading-6 text-text-secondary">
      {{ $t('agent.settings.providers.deleteProviderConfirmPrompt', { name: deletingProvider?.displayName || '' }) }}
    </p>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UiButton appearance="soft" tone="neutral" type="button" :disabled="busy" @click="deletingProvider = null">
          {{ $t('common.cancel') }}
        </UiButton>
        <button
          type="button"
          class="rounded-lg bg-error px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-error/90 active:scale-95 disabled:opacity-50 cursor-pointer"
          :disabled="busy"
          @click="confirmDelete"
        >
          {{ $t('agent.settings.providers.deleteConfirm') }}
        </button>
      </div>
    </template>
  </BaseModal>

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
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-foreground">{{
              $t('agent.settings.providers.protocol')
            }}</span>
            <UiSelect
              class="w-full"
              :model-value="form.protocol"
              :options="[
                { value: 'chat-completions', label: $t('agent.settings.providers.protocolChat') },
                { value: 'responses', label: $t('agent.settings.providers.protocolResponses') },
              ]"
              @update:model-value="(value: unknown) => (form.protocol = protocolFromValue(value))"
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

        <!-- 从接口直接拉取模型 -->
        <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-header/25 border border-border/60">
          <div class="flex items-center gap-2 text-xs text-text-secondary">
            <i class="fa-solid fa-cloud-arrow-down text-primary" aria-hidden="true"></i>
            <span v-if="pulledModels.length === 0">{{ $t('agent.settings.providers.pullModelsHint') }}</span>
            <span v-else class="text-foreground font-medium">
              {{ $t('agent.settings.providers.pullSuccess', { count: pulledModels.length }) }}
            </span>
          </div>
          <UiButton
            appearance="soft"
            tone="primary"
            size="sm"
            type="button"
            :disabled="isPullingModels || !form.baseUrl.trim()"
            @click="pullModelsFromEndpoint"
          >
            <i v-if="!isPullingModels" class="fa-solid fa-rotate text-xs mr-1" aria-hidden="true"></i>
            <i v-else class="fa-solid fa-circle-notch fa-spin text-xs mr-1" aria-hidden="true"></i>
            <span>{{
              isPullingModels ? $t('agent.settings.providers.pullingModels') : $t('agent.settings.providers.pullModels')
            }}</span>
          </UiButton>
        </div>

        <!-- 若已成功拉取模型，提供下拉选择与批量导入 -->
        <div v-if="pulledModels.length > 0" class="p-3 rounded-xl bg-primary/5 border border-primary/20 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <i class="fa-solid fa-list-check text-primary text-[11px]" aria-hidden="true"></i>
              {{ $t('agent.settings.providers.selectPulledModel') }}
            </span>
            <label class="inline-flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer select-none">
              <UiCheckbox v-model="importAllPulled" />
              <span>{{ $t('agent.settings.providers.importAllPulled', { count: pulledModels.length }) }}</span>
            </label>
          </div>
          <UiSelect
            :model-value="selectedPulledModelKey"
            :options="pulledModelOptions"
            density="compact"
            class="w-full"
            panel-class="max-h-60"
            @update:model-value="onSelectPulledModel"
          />
        </div>

        <!-- 初始模型配置 -->
        <div class="rounded-xl border border-border/60 bg-header/15 p-3 space-y-2.5">
          <div class="text-[11px] font-semibold text-foreground flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <i class="fa-solid fa-cubes text-primary text-[10px]"></i>
              <span>{{ $t('agent.settings.providers.initialModel') }}</span>
            </span>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <label
                class="inline-flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer select-none"
              >
                <UiCheckbox v-model="form.supportsTools" />
                <span>{{ $t('agent.settings.providers.tools') }}</span>
              </label>
              <label
                class="inline-flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer select-none"
              >
                <UiCheckbox v-model="form.supportsImageInput" />
                <span>{{ $t('agent.settings.providers.imageInput') }}</span>
              </label>
              <label
                class="inline-flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer select-none"
              >
                <UiCheckbox v-model="form.supportsFileInput" />
                <span>{{ $t('agent.settings.providers.fileInput') }}</span>
              </label>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <label class="block">
              <span class="mb-1 block text-[11px] text-text-secondary"
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
              <span class="mb-1 block text-[11px] text-text-secondary">{{
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
              <span class="mb-1 block text-[11px] text-text-secondary">{{
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
            ? 'border-success/30 bg-success/10 text-success '
            : 'border-error/30 bg-error/10 text-error'
        "
      >
        <div class="flex items-center gap-2">
          <i :class="modalTestResult.ok ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'" class="text-sm"></i>
          <span class="font-medium">{{ modalTestResult.message }}</span>
        </div>
        <span v-if="modalTestResult.latencyMs" class="font-mono text-[11px]">
          {{ $t('agent.settings.providers.latency', { ms: modalTestResult.latencyMs }) }}
        </span>
      </div>
    </div>

    <!-- 弹窗底部操作工具栏 -->
    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <!-- 左侧：模型测试按钮 -->
        <div>
          <UiButton
            appearance="soft"
            tone="neutral"
            type="button"
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
          </UiButton>
        </div>

        <!-- 右侧：取消与确认保存 -->
        <div class="flex items-center gap-2">
          <UiButton appearance="soft" tone="neutral" type="button" :disabled="modalTesting" @click="closeModal">
            {{ $t('common.cancel') }}
          </UiButton>
          <UiButton
            appearance="solid"
            tone="primary"
            type="button"
            :disabled="modalTesting || busy || !form.displayName.trim() || !form.baseUrl.trim() || !form.modelId.trim()"
            @click="submitModal"
          >
            <i v-if="createdProviderId" class="fa-solid fa-check text-xs"></i>
            <span>{{ createdProviderId ? $t('common.confirm') : $t('agent.settings.providers.saveAndAdd') }}</span>
          </UiButton>
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
            class="shrink-0 inline-flex items-center gap-1 rounded-full bg-success/10 border border-success/25 px-2 py-0.5 text-[11px] font-medium text-success"
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
                  class="inline-flex items-center gap-1 rounded-md bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[11px] font-semibold text-primary"
                >
                  <i class="fa-solid fa-star text-[8px]"></i>
                  <span>{{ $t('agent.settings.providers.defaultBadge') }}</span>
                </span>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-secondary">
                <span class="rounded bg-card border border-border/50 px-1.5 py-0.5 font-mono">
                  {{ $t('agent.settings.providers.contextShort', { value: compactTokens(model.contextWindow) }) }}
                </span>
                <span class="rounded bg-card border border-border/50 px-1.5 py-0.5 font-mono">
                  {{ $t('agent.settings.providers.outputShort', { value: compactTokens(model.maxOutputTokens) }) }}
                </span>
                <span
                  v-if="model.supportsTools"
                  class="rounded bg-success/10 text-success border border-success/20 px-1.5 py-0.5 font-medium"
                >
                  Tools
                </span>
                <span
                  v-if="model.supportsImageInput"
                  class="rounded bg-info/10 text-info border border-info/20 px-1.5 py-0.5 font-medium"
                >
                  {{ $t('agent.settings.providers.imageInput') }}
                </span>
                <span
                  v-if="model.supportsFileInput"
                  class="rounded bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 font-medium"
                >
                  {{ $t('agent.settings.providers.fileInput') }}
                </span>
                <span
                  v-if="model.reasoningEfforts?.length"
                  class="inline-flex items-center gap-1 rounded bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 font-medium"
                >
                  <i class="fa-solid fa-brain text-[8px]"></i>
                  <span>{{ $t('agent.settings.providers.reasoning') }}</span>
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
                  ? 'bg-success/10 text-success  border border-success/20'
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
                class="text-[11px]"
              ></i>
              <span>{{ testResults[testKey(currentTestModalProvider, model.id)]?.message }}</span>
            </span>

            <!-- 设为默认模型 -->
            <UiButton
              appearance="soft"
              tone="neutral"
              v-if="!(currentTestModalProvider.id === defaultProviderId && model.id === defaultModelId)"
              type="button"
              :disabled="busy || !currentTestModalProvider.enabled"
              @click="emit('defaultModel', currentTestModalProvider.id, model.id)"
            >
              {{ $t('agent.settings.providers.setDefault') }}
            </UiButton>

            <UiButton
              appearance="soft"
              tone="neutral"
              type="button"
              :disabled="busy"
              @click="openCapabilityEditor(currentTestModalProvider, model)"
            >
              <i class="fa-solid fa-sliders text-[10px]" aria-hidden="true"></i>
              <span>{{ $t('agent.settings.providers.capabilityEdit') }}</span>
            </UiButton>

            <!-- 快速测试连通性 -->
            <UiButton
              appearance="soft"
              tone="neutral"
              type="button"
              :disabled="
                busy ||
                !currentTestModalProvider.enabled ||
                testResults[testKey(currentTestModalProvider, model.id)]?.state === 'loading'
              "
              @click="testModel(currentTestModalProvider, model.id)"
            >
              <i class="fa-solid fa-vial text-[10px]" aria-hidden="true"></i>
              <span>{{ $t('agent.settings.providers.test') }}</span>
            </UiButton>

            <!-- 取消已添加模型 -->
            <UiButton
              type="button"
              appearance="soft"
              :tone="
                currentTestModalProvider.models.length <= 1 ||
                (currentTestModalProvider.id === defaultProviderId && model.id === defaultModelId)
                  ? 'neutral'
                  : 'danger'
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
            </UiButton>
          </div>
        </div>

        <div v-if="filteredTestModalModels.length === 0" class="py-8 text-center text-xs text-text-secondary">
          {{ $t('agent.settings.providers.noMatchingModel') }}
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <i class="fa-solid fa-cloud-check text-success text-xs"></i>
          <span>{{ $t('agent.settings.providers.autoSaveHint') }}</span>
        </div>
        <UiButton appearance="soft" tone="neutral" type="button" @click="testModalOpen = false">
          {{ $t('common.close') }}
        </UiButton>
      </div>
    </template>
  </BaseModal>

  <ModelCapabilityEditor
    :visible="Boolean(capabilityEditor && capabilityEditorModel)"
    :provider="capabilityEditorProvider"
    :model="capabilityEditorModel"
    :busy="busy"
    @close="closeCapabilityEditor"
    @save="saveCapabilities"
  />
</template>
