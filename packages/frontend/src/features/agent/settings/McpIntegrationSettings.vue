<script setup lang="ts">
  import { BaseModal, UiButton, UiCheckbox, UiInfoHint } from '@/foundation/ui';
  import { computed, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useFeedback, useOperationFeedback } from '@/shared/feedback/public';
  import {
    agentApi,
    formatAgentApiError,
    type AgentIntegrationViewDto,
    type AgentMcpIntegrationConfigurationDto,
  } from '../api/agent-api';
  import { formatAgentTime } from '../locale-format';

  const DEFAULT_AGENT_APP_ID = 'nexus.agent';
  const props = defineProps<{ busy: boolean; agentAvailable: boolean }>();
  const { t, locale } = useI18n();
  const feedback = useFeedback();
  const operationFeedback = useOperationFeedback('agent.settings.mcp');

  const integrations = ref<AgentIntegrationViewDto[]>([]);
  const credentialDrafts = reactive<Record<string, string>>({});
  const localBusy = ref(false);
  const loading = ref(false);
  const disabled = computed(() => props.busy || localBusy.value || !props.agentAvailable);
  let integrationsGeneration = 0;

  // 模态弹窗状态
  const modalOpen = ref(false);
  const modalError = ref('');
  const showCredential = ref(false);
  const form = reactive({
    displayName: '',
    endpoint: '',
    credential: '',
    trustToolAnnotations: false,
    enabled: true,
  });
  let pendingCreateIdentity: { fingerprint: string; idempotencyKey: string } | null = null;

  const copiedUrl = ref<string | null>(null);
  const copyEndpoint = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      copiedUrl.value = url;
      operationFeedback.notifySuccess(t('agent.settings.plugins.copied'));
      setTimeout(() => {
        if (copiedUrl.value === url) copiedUrl.value = null;
      }, 2000);
    } catch {
      // ignore clipboard error
    }
  };

  const mcpConfiguration = (integration: AgentIntegrationViewDto): AgentMcpIntegrationConfigurationDto => {
    if (integration.kind !== 'mcp' || integration.configuration.transport !== 'streamable-http') {
      throw new Error('MCP_INTEGRATION_INVALID');
    }
    return integration.configuration as AgentMcpIntegrationConfigurationDto;
  };

  const explain = (cause: unknown): string =>
    formatAgentApiError(cause, t('agent.settings.mcpIntegrations.requestFailed'), t);

  const loadIntegrations = async (): Promise<void> => {
    const generation = ++integrationsGeneration;
    if (!props.agentAvailable) {
      integrations.value = [];
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const next = await agentApi.integrations(DEFAULT_AGENT_APP_ID, 'mcp');
      if (generation !== integrationsGeneration || !props.agentAvailable) return;
      integrations.value = next;
    } catch (cause) {
      if (generation !== integrationsGeneration || !props.agentAvailable) return;
      operationFeedback.notifyError({ operation: 'load-integrations', message: explain(cause), cause });
    } finally {
      if (generation === integrationsGeneration) loading.value = false;
    }
  };

  const run = async (operation: string, action: () => Promise<void>, success = ''): Promise<void> => {
    if (disabled.value) return;
    localBusy.value = true;
    try {
      await action();
      if (success) operationFeedback.notifySuccess(success);
    } catch (cause) {
      operationFeedback.notifyError({ operation, message: explain(cause), cause });
    } finally {
      localBusy.value = false;
    }
  };

  const openAddModal = (): void => {
    pendingCreateIdentity = null;
    form.displayName = '';
    form.endpoint = '';
    form.credential = '';
    form.trustToolAnnotations = false;
    form.enabled = true;
    modalError.value = '';
    showCredential.value = false;
    modalOpen.value = true;
  };

  const closeAddModal = (): void => {
    pendingCreateIdentity = null;
    modalOpen.value = false;
    modalError.value = '';
  };

  const submitAddModal = async (): Promise<void> => {
    if (disabled.value) return;
    const name = form.displayName.trim();
    const url = form.endpoint.trim();
    if (!name || !url) {
      modalError.value = t('agent.settings.disabledReason.incompleteForm');
      return;
    }

    localBusy.value = true;
    modalError.value = '';
    try {
      const input = {
        kind: 'mcp' as const,
        configuration: {
          displayName: name,
          transport: 'streamable-http' as const,
          endpoint: url,
          privateHostExceptions: [],
          protocolVersion: '2026-07-28' as const,
          trustToolAnnotations: form.trustToolAnnotations,
        },
        enabled: form.enabled,
        ...(form.credential.trim() ? { credential: form.credential.trim() } : {}),
      };
      const fingerprint = JSON.stringify(input);
      if (!pendingCreateIdentity || pendingCreateIdentity.fingerprint !== fingerprint) {
        pendingCreateIdentity = { fingerprint, idempotencyKey: crypto.randomUUID() };
      }
      await agentApi.createIntegration(DEFAULT_AGENT_APP_ID, input, pendingCreateIdentity.idempotencyKey);
      pendingCreateIdentity = null;
      operationFeedback.notifySuccess(t('agent.settings.mcpIntegrations.created'));
      closeAddModal();
      await loadIntegrations();
    } catch (cause) {
      modalError.value = explain(cause);
    } finally {
      localBusy.value = false;
    }
  };

  const toggleIntegration = (integration: AgentIntegrationViewDto, nextEnabled: boolean): void => {
    const configuration = mcpConfiguration(integration);
    void run(
      'toggle-integration',
      async () => {
        await agentApi.updateIntegration(DEFAULT_AGENT_APP_ID, integration, {
          kind: 'mcp',
          configuration,
          enabled: nextEnabled,
        });
        await loadIntegrations();
      },
      t('agent.settings.mcpIntegrations.updated'),
    );
  };

  const replaceCredential = (integration: AgentIntegrationViewDto): void => {
    const nextCredential = (credentialDrafts[integration.id] ?? '').trim();
    if (!nextCredential) return;
    const configuration = mcpConfiguration(integration);
    void run(
      'replace-credential',
      async () => {
        await agentApi.updateIntegration(DEFAULT_AGENT_APP_ID, integration, {
          kind: 'mcp',
          configuration: { ...configuration },
          enabled: integration.enabled,
          credential: nextCredential,
        });
        credentialDrafts[integration.id] = '';
        await loadIntegrations();
      },
      t('agent.settings.mcpIntegrations.credentialUpdated'),
    );
  };

  const clearCredential = (integration: AgentIntegrationViewDto): void => {
    const configuration = mcpConfiguration(integration);
    void run(
      'clear-credential',
      async () => {
        await agentApi.updateIntegration(DEFAULT_AGENT_APP_ID, integration, {
          kind: 'mcp',
          configuration: { ...configuration },
          enabled: integration.enabled,
          clearCredential: true,
        });
        credentialDrafts[integration.id] = '';
        await loadIntegrations();
      },
      t('agent.settings.mcpIntegrations.credentialCleared'),
    );
  };

  const refreshIntegration = (integration: AgentIntegrationViewDto): void => {
    void run(
      'refresh-integration',
      async () => {
        try {
          await agentApi.refreshIntegration(DEFAULT_AGENT_APP_ID, integration.id);
        } finally {
          await loadIntegrations();
        }
      },
      t('agent.settings.mcpIntegrations.refreshed'),
    );
  };

  const removeIntegration = async (integration: AgentIntegrationViewDto): Promise<void> => {
    const confirmed = await feedback.confirm({
      title: t('agent.settings.mcpIntegrations.delete'),
      message: t('agent.settings.mcpIntegrations.confirmDelete', {
        name: mcpConfiguration(integration).displayName,
      }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
    });
    if (!confirmed) return;
    void run(
      'remove-integration',
      async () => {
        await agentApi.deleteIntegration(DEFAULT_AGENT_APP_ID, integration);
        delete credentialDrafts[integration.id];
        await loadIntegrations();
      },
      t('agent.settings.mcpIntegrations.deleted'),
    );
  };

  const statusLabel = (integration: AgentIntegrationViewDto): string => {
    if (integration.refreshState === 'refreshing') return t('agent.settings.mcpIntegrations.status.refreshing');
    if (integration.lastErrorCode) return t('agent.settings.mcpIntegrations.status.error');
    if (integration.lastSuccessAt) return t('agent.settings.mcpIntegrations.status.ready');
    return t('agent.settings.mcpIntegrations.status.idle');
  };

  const statusClass = (integration: AgentIntegrationViewDto): string => {
    if (integration.refreshState === 'refreshing') return 'border-primary/40 bg-primary/10 text-primary';
    if (integration.lastErrorCode) return 'border-error/40 bg-error/10 text-error';
    if (integration.lastSuccessAt) return 'border-success/40 bg-success/10 text-success';
    return 'border-border/70 bg-header/40 text-text-secondary';
  };

  const formatTime = (timestamp: number | null): string => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '—' : formatAgentTime(locale.value, date);
  };

  watch(
    () => props.agentAvailable,
    () => {
      void loadIntegrations();
    },
    { immediate: true },
  );
</script>

<template>
  <section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition-all">
    <!-- 顶栏：标题、说明与添加入口 -->
    <div
      class="flex flex-wrap items-center justify-between gap-3 bg-header/35 px-4 py-3 sm:px-5 sm:py-3.5 rounded-t-2xl agent-settings-head"
      :class="{ 'border-b border-border': integrations.length > 0 || !agentAvailable }"
    >
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.mcpIntegrations.title') }}</h3>
        <span
          v-if="integrations.length > 0"
          class="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-text-secondary"
        >
          {{ integrations.length }}
        </span>
        <UiInfoHint :text="$t('agent.settings.mcpIntegrations.description')" />
      </div>
      <div class="flex items-center gap-2">
        <UiButton
          appearance="soft"
          tone="neutral"
          density="default"
          icon-only
          type="button"
          :disabled="disabled || loading || !agentAvailable"
          :title="$t('agent.settings.mcpIntegrations.reload')"
          :aria-label="$t('agent.settings.mcpIntegrations.reload')"
          @click="loadIntegrations"
        >
          <i class="fa-solid fa-arrows-rotate text-xs" :class="{ 'fa-spin': loading }" aria-hidden="true"></i>
        </UiButton>
        <UiButton
          appearance="soft"
          tone="neutral"
          type="button"
          :disabled="disabled || !agentAvailable"
          class="w-[88px]"
          @click="openAddModal"
        >
          <span class="inline-flex items-center gap-1.5 text-xs">
            <i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.mcpIntegrations.create') }}</span>
          </span>
        </UiButton>
      </div>
    </div>

    <!-- Agent 未就绪时的提示 -->
    <div v-if="!agentAvailable" class="p-4 text-xs text-warning bg-warning/10 border-b border-warning/20">
      {{ $t('agent.settings.mcpIntegrations.installAgentFirst') }}
    </div>

    <!-- 已添加列表：没有的话完全不显示任何占位 -->
    <div v-if="integrations.length > 0" class="space-y-3 p-4 sm:p-5">
      <article
        v-for="integration in integrations"
        :key="integration.id"
        class="rounded-2xl border border-border/80 bg-card/80 p-4 transition-all hover:bg-card/95 shadow-2xs space-y-3"
      >
        <!-- 卡片主体：图标、名称大字号高质感、状态徽标、URL 及右侧操作按钮 -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex items-start sm:items-center gap-3 min-w-0 flex-1">
            <div
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border border-primary/25 text-primary shadow-2xs"
            >
              <i class="fa-solid fa-plug text-sm" aria-hidden="true"></i>
            </div>
            <div class="min-w-0 flex-1 space-y-1.5">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="inline-flex items-center rounded-xl border border-border/90 bg-background/90 px-3 py-1 text-sm sm:text-base font-bold tracking-tight text-foreground shadow-2xs"
                >
                  {{ mcpConfiguration(integration).displayName }}
                </span>
                <span
                  class="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all"
                  :class="statusClass(integration)"
                >
                  {{ statusLabel(integration) }}
                </span>
                <span
                  v-if="mcpConfiguration(integration).trustToolAnnotations"
                  class="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] text-primary font-medium"
                >
                  <i class="fa-solid fa-shield-check text-[9px]" aria-hidden="true"></i>
                  <span>{{ $t('agent.settings.mcpIntegrations.trustAnnotations') }}</span>
                </span>
              </div>

              <!-- Base URL 链接副行与复制反馈 -->
              <div class="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                <button
                  type="button"
                  class="group/url inline-flex items-center gap-1.5 font-mono text-[11px] text-text-secondary hover:text-foreground transition-colors cursor-pointer select-none"
                  :title="
                    copiedUrl === mcpConfiguration(integration).endpoint
                      ? $t('agent.settings.plugins.copied')
                      : mcpConfiguration(integration).endpoint
                  "
                  @click="copyEndpoint(mcpConfiguration(integration).endpoint)"
                >
                  <i
                    class="fa-solid fa-link text-[10px] text-text-secondary/60 group-hover/url:text-primary transition-colors shrink-0"
                    aria-hidden="true"
                  ></i>
                  <span class="max-w-[260px] sm:max-w-[420px] truncate">{{
                    mcpConfiguration(integration).endpoint
                  }}</span>
                  <i
                    v-if="copiedUrl === mcpConfiguration(integration).endpoint"
                    class="fa-solid fa-check text-[10px] text-success"
                    aria-hidden="true"
                  ></i>
                  <i
                    v-else
                    class="fa-regular fa-copy text-[10px] text-text-secondary/40 group-hover/url:text-primary transition-colors"
                    aria-hidden="true"
                  ></i>
                </button>
              </div>
            </div>
          </div>

          <!-- 右侧操作工具条（仅图标） -->
          <div
            class="flex items-center justify-end gap-1.5 shrink-0 pt-2 sm:pt-0 border-t border-border/30 sm:border-0"
          >
            <UiButton
              appearance="soft"
              tone="neutral"
              density="compact"
              icon-only
              type="button"
              :disabled="disabled || !integration.enabled || integration.refreshState === 'refreshing'"
              :title="$t('agent.settings.mcpIntegrations.retry')"
              :aria-label="$t('agent.settings.mcpIntegrations.retry')"
              @click="refreshIntegration(integration)"
            >
              <i
                class="fa-solid fa-arrows-rotate text-xs"
                :class="{ 'fa-spin': integration.refreshState === 'refreshing' }"
                aria-hidden="true"
              ></i>
            </UiButton>
            <UiButton
              type="button"
              appearance="soft"
              density="compact"
              icon-only
              :tone="integration.enabled ? 'danger' : 'success'"
              :disabled="disabled"
              :title="
                integration.enabled ? $t('agent.settings.providers.disable') : $t('agent.settings.providers.enable')
              "
              :aria-label="
                integration.enabled ? $t('agent.settings.providers.disable') : $t('agent.settings.providers.enable')
              "
              @click="toggleIntegration(integration, !integration.enabled)"
            >
              <i
                :class="integration.enabled ? 'fa-solid fa-power-off' : 'fa-solid fa-play'"
                class="text-xs"
                aria-hidden="true"
              ></i>
            </UiButton>
            <UiButton
              appearance="soft"
              tone="danger"
              density="compact"
              icon-only
              type="button"
              :disabled="disabled"
              :title="$t('agent.settings.mcpIntegrations.delete')"
              :aria-label="$t('agent.settings.mcpIntegrations.delete')"
              @click="removeIntegration(integration)"
            >
              <i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
            </UiButton>
          </div>
        </div>

        <!-- 凭据维护与运行状态条 -->
        <div class="grid gap-2 sm:grid-cols-[1fr_auto] items-center pt-2.5 border-t border-border/40 text-xs">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary">
            <span>
              {{ $t('agent.settings.mcpIntegrations.lastSuccess') }}:
              <strong class="text-foreground font-mono">{{ formatTime(integration.lastSuccessAt) }}</strong>
            </span>
            <span>
              {{ $t('agent.settings.mcpIntegrations.lastAttempt') }}:
              <strong class="text-foreground font-mono">{{ formatTime(integration.lastAttemptAt) }}</strong>
            </span>
            <span v-if="integration.lastErrorCode" class="text-error font-mono font-medium">
              {{ integration.lastErrorCode }}
            </span>
          </div>
          <div class="flex items-center justify-end gap-1.5">
            <input
              v-model="credentialDrafts[integration.id]"
              type="password"
              autocomplete="new-password"
              class="h-7.5 w-36 sm:w-44 rounded-lg border border-border/80 bg-background px-2.5 font-mono text-[11px] text-foreground outline-none focus:border-border-hover"
              :placeholder="$t('agent.settings.mcpIntegrations.replaceCredential')"
              :disabled="disabled"
            />
            <UiButton
              appearance="soft"
              tone="neutral"
              density="compact"
              type="button"
              :disabled="disabled || !(credentialDrafts[integration.id] ?? '').trim()"
              @click="replaceCredential(integration)"
            >
              {{ $t('agent.settings.mcpIntegrations.saveCredential') }}
            </UiButton>
            <UiButton
              v-if="integration.hasCredential"
              appearance="soft"
              tone="danger"
              density="compact"
              type="button"
              :disabled="disabled"
              @click="clearCredential(integration)"
            >
              {{ $t('agent.settings.mcpIntegrations.clearCredential') }}
            </UiButton>
          </div>
        </div>
      </article>

      <!-- 底部轻量新增按钮 -->
      <button
        type="button"
        :disabled="disabled || !agentAvailable"
        class="group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-header/10 hover:bg-primary/5 hover:border-primary/45 py-2.5 text-xs text-text-secondary hover:text-primary transition-all duration-200 cursor-pointer select-none active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
        @click="openAddModal"
      >
        <i
          class="fa-solid fa-plus text-[11px] text-primary/70 group-hover:text-primary transition-colors"
          aria-hidden="true"
        ></i>
        <span class="font-medium">{{ $t('agent.settings.mcpIntegrations.create') }}</span>
      </button>
    </div>

    <!-- 添加 MCP 集成模态弹窗（遵循添加模型服务商 (Provider) 新 UI 风格） -->
    <BaseModal
      :visible="modalOpen"
      :title="$t('agent.settings.mcpIntegrations.modalTitle')"
      :aria-label="$t('agent.settings.mcpIntegrations.modalTitle')"
      :close-on-backdrop="!localBusy"
      :close-on-escape="!localBusy"
      :focus-on-open="true"
      :restore-focus="true"
      panel-class="max-w-xl p-5 sm:p-6 rounded-2xl shadow-2xl border border-border/80 bg-card"
      @close="closeAddModal"
    >
      <div class="space-y-4">
        <p class="text-xs text-text-secondary leading-relaxed">
          {{ $t('agent.settings.mcpIntegrations.modalDescription') }}
        </p>

        <div class="space-y-3.5">
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-foreground">
              {{ $t('agent.settings.mcpIntegrations.displayName') }} <span class="text-error">*</span>
            </span>
            <div class="relative flex items-center">
              <i
                class="fa-solid fa-cube absolute left-3 text-text-secondary text-xs pointer-events-none"
                aria-hidden="true"
              ></i>
              <input
                v-model="form.displayName"
                required
                data-no-highlight
                class="h-9 w-full rounded-lg border border-border/80 bg-background pl-8 pr-3 text-xs text-foreground outline-none focus:border-border-hover"
                :placeholder="$t('agent.settings.mcpIntegrations.displayName')"
              />
            </div>
          </label>

          <label class="block">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs font-medium text-foreground">
                {{ $t('agent.settings.mcpIntegrations.endpoint') }} <span class="text-error">*</span>
              </span>
              <span class="text-[10px] text-text-secondary">{{
                $t('agent.settings.mcpIntegrations.mcpEndpointHint')
              }}</span>
            </div>
            <div class="relative flex items-center">
              <i
                class="fa-solid fa-link absolute left-3 text-text-secondary text-xs pointer-events-none"
                aria-hidden="true"
              ></i>
              <input
                v-model="form.endpoint"
                required
                type="url"
                data-no-highlight
                class="h-9 w-full rounded-lg border border-border/80 bg-background pl-8 pr-3 font-mono text-xs text-foreground outline-none focus:border-border-hover"
                placeholder="https://mcp.example.com/streamable"
              />
            </div>
          </label>

          <label class="block">
            <span class="mb-1 block text-xs font-medium text-foreground">
              {{ $t('agent.settings.mcpIntegrations.credential') }}
            </span>
            <div class="relative flex items-center">
              <i
                class="fa-solid fa-key absolute left-3 text-text-secondary text-xs pointer-events-none"
                aria-hidden="true"
              ></i>
              <input
                v-model="form.credential"
                :type="showCredential ? 'text' : 'password'"
                autocomplete="new-password"
                data-no-highlight
                class="h-9 w-full rounded-lg border border-border/80 bg-background pl-8 pr-9 font-mono text-xs text-foreground outline-none focus:border-border-hover"
                placeholder="Bearer token / API key"
              />
              <button
                type="button"
                class="absolute right-2.5 text-text-secondary hover:text-foreground transition-colors cursor-pointer"
                @click="showCredential = !showCredential"
              >
                <i :class="showCredential ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'" class="text-xs"></i>
              </button>
            </div>
          </label>

          <div class="rounded-xl border border-border/60 bg-header/15 p-3.5 space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-foreground">{{
                $t('agent.settings.mcpIntegrations.trustAnnotations')
              }}</span>
              <label class="inline-flex items-center cursor-pointer select-none">
                <UiCheckbox v-model="form.trustToolAnnotations" />
              </label>
            </div>
            <div class="border-t border-border/40 pt-2.5 flex items-center justify-between">
              <span class="text-xs font-medium text-foreground">{{
                $t('agent.settings.mcpIntegrations.enabled')
              }}</span>
              <label class="inline-flex items-center cursor-pointer select-none">
                <UiCheckbox v-model="form.enabled" />
              </label>
            </div>
          </div>
        </div>

        <div
          v-if="modalError"
          class="rounded-lg border border-error/30 bg-error/10 p-2.5 text-xs text-error flex items-center gap-2"
        >
          <i class="fa-solid fa-triangle-exclamation shrink-0" aria-hidden="true"></i>
          <span>{{ modalError }}</span>
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <UiButton appearance="soft" tone="neutral" type="button" :disabled="localBusy" @click="closeAddModal">
            {{ $t('common.cancel') }}
          </UiButton>
          <UiButton
            appearance="solid"
            tone="primary"
            type="button"
            :disabled="disabled || !form.displayName.trim() || !form.endpoint.trim()"
            @click="submitAddModal"
          >
            <i class="fa-solid fa-plus text-xs" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.providers.saveAndAdd') }}</span>
          </UiButton>
        </div>
      </template>
    </BaseModal>
  </section>
</template>
