<script setup lang="ts">
  import { UiButton } from '@/foundation/ui';
  import { computed, onMounted, reactive, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useFeedback, useOperationFeedback } from '@/shared/feedback/public';
  import {
    agentApi,
    formatAgentApiError,
    type AgentIntegrationViewDto,
    type AgentMcpIntegrationConfigurationDto,
  } from '../api/agent-api';

  const DEFAULT_AGENT_APP_ID = 'nexus.agent';
  const props = defineProps<{ busy: boolean; agentAvailable: boolean }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const operationFeedback = useOperationFeedback('agent.settings.mcp');

  const integrations = ref<AgentIntegrationViewDto[]>([]);
  const displayName = ref('');
  const endpoint = ref('');
  const credential = ref('');
  const enabled = ref(true);
  const trustToolAnnotations = ref(false);
  const credentialDrafts = reactive<Record<string, string>>({});
  const localBusy = ref(false);
  const loading = ref(false);
  const disabled = computed(() => props.busy || localBusy.value);

  const mcpConfiguration = (integration: AgentIntegrationViewDto): AgentMcpIntegrationConfigurationDto => {
    if (integration.kind !== 'mcp' || integration.configuration.transport !== 'streamable-http') {
      throw new Error('MCP_INTEGRATION_INVALID');
    }
    return integration.configuration as AgentMcpIntegrationConfigurationDto;
  };

  const explain = (cause: unknown): string =>
    formatAgentApiError(cause, t('agent.settings.mcpIntegrations.requestFailed'));

  const loadIntegrations = async (): Promise<void> => {
    if (!props.agentAvailable) {
      integrations.value = [];
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      integrations.value = await agentApi.integrations(DEFAULT_AGENT_APP_ID, 'mcp');
    } catch (cause) {
      operationFeedback.notifyError({ operation: 'load-integrations', message: explain(cause), cause });
    } finally {
      loading.value = false;
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

  const createIntegration = (): void => {
    const name = displayName.value.trim();
    const url = endpoint.value.trim();
    if (!name || !url) return;
    void run(
      'create-integration',
      async () => {
        await agentApi.createIntegration(DEFAULT_AGENT_APP_ID, {
          kind: 'mcp',
          configuration: {
            displayName: name,
            transport: 'streamable-http',
            endpoint: url,
            privateHostExceptions: [],
            protocolVersion: '2026-07-28',
            trustToolAnnotations: trustToolAnnotations.value,
          },
          enabled: enabled.value,
          ...(credential.value.trim() ? { credential: credential.value.trim() } : {}),
        });
        displayName.value = '';
        endpoint.value = '';
        credential.value = '';
        enabled.value = true;
        trustToolAnnotations.value = false;
        await loadIntegrations();
      },
      t('agent.settings.mcpIntegrations.created'),
    );
  };

  const updateConfiguration = (
    integration: AgentIntegrationViewDto,
    configuration: AgentMcpIntegrationConfigurationDto,
    success: string,
  ): void => {
    void run(
      'update-integration',
      async () => {
        await agentApi.updateIntegration(DEFAULT_AGENT_APP_ID, integration, {
          kind: 'mcp',
          configuration,
          enabled: integration.enabled,
        });
        await loadIntegrations();
      },
      success,
    );
  };

  const changeEndpoint = (integration: AgentIntegrationViewDto, nextEndpoint: string): void => {
    const normalized = nextEndpoint.trim();
    const configuration = mcpConfiguration(integration);
    if (!normalized || normalized === configuration.endpoint) return;
    updateConfiguration(
      integration,
      { ...configuration, endpoint: normalized },
      t('agent.settings.mcpIntegrations.updated'),
    );
  };

  const toggleTrustAnnotations = (integration: AgentIntegrationViewDto, trusted: boolean): void => {
    const configuration = mcpConfiguration(integration);
    if (configuration.trustToolAnnotations === trusted) return;
    updateConfiguration(
      integration,
      { ...configuration, trustToolAnnotations: trusted },
      t('agent.settings.mcpIntegrations.updated'),
    );
  };

  const toggleIntegration = (integration: AgentIntegrationViewDto, nextEnabled: boolean): void => {
    const configuration = mcpConfiguration(integration);
    void run(
      'toggle-integration',
      async () => {
        await agentApi.updateIntegration(DEFAULT_AGENT_APP_ID, integration, {
          kind: 'mcp',
          configuration: { ...configuration },
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
    if (
      !(await feedback.confirm({
        message: t('agent.settings.mcpIntegrations.confirmDelete', {
          name: mcpConfiguration(integration).displayName,
        }),
        destructive: true,
      }))
    ) {
      return;
    }
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

  const statusLabel = (integration: AgentIntegrationViewDto): string =>
    t(`agent.settings.mcpIntegrations.status.${integration.refreshState}`);

  const statusClass = (integration: AgentIntegrationViewDto): string => {
    if (integration.refreshState === 'ready') return 'border-success/40 bg-success/10 text-success';
    if (integration.refreshState === 'error') return 'border-error/40 bg-error/10 text-error';
    if (integration.refreshState === 'refreshing') return 'border-primary/40 bg-primary/10 text-primary';
    return 'border-border bg-card text-text-secondary';
  };

  const formatTime = (value: number | null): string => (value === null ? '—' : new Date(value * 1000).toLocaleString());

  onMounted(() => void loadIntegrations());
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/35">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5"
    >
      <div>
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.mcpIntegrations.title') }}</h3>
        <p class="mt-0.5 text-xs text-text-secondary">{{ $t('agent.settings.mcpIntegrations.description') }}</p>
      </div>
      <UiButton
        appearance="soft"
        tone="neutral"
        type="button"
        :disabled="disabled || loading || !agentAvailable"
        @click="loadIntegrations"
      >
        {{ $t('agent.settings.mcpIntegrations.reload') }}
      </UiButton>
    </div>

    <div class="space-y-4 p-4 sm:p-5">
      <p v-if="!agentAvailable" class="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
        {{ $t('agent.settings.mcpIntegrations.installAgentFirst') }}
      </p>

      <div class="grid gap-2 md:grid-cols-2">
        <label class="text-[11px] text-text-secondary">
          {{ $t('agent.settings.mcpIntegrations.displayName') }}
          <input
            v-model="displayName"
            class="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs"
            :disabled="disabled || !agentAvailable"
          />
        </label>
        <label class="text-[11px] text-text-secondary">
          {{ $t('agent.settings.mcpIntegrations.endpoint') }}
          <input
            v-model="endpoint"
            class="mt-1 w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs"
            placeholder="https://mcp.example.com/"
            :disabled="disabled || !agentAvailable"
          />
        </label>
        <label class="text-[11px] text-text-secondary">
          {{ $t('agent.settings.mcpIntegrations.credential') }}
          <input
            v-model="credential"
            type="password"
            autocomplete="new-password"
            class="mt-1 w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs"
            :disabled="disabled || !agentAvailable"
          />
        </label>
        <div class="flex flex-wrap items-end gap-4 pb-1 text-xs">
          <label class="flex items-center gap-1">
            <input v-model="enabled" type="checkbox" :disabled="disabled || !agentAvailable" />
            {{ $t('agent.settings.mcpIntegrations.enabled') }}
          </label>
          <label class="flex items-center gap-1">
            <input v-model="trustToolAnnotations" type="checkbox" :disabled="disabled || !agentAvailable" />
            {{ $t('agent.settings.mcpIntegrations.trustAnnotations') }}
          </label>
        </div>
      </div>

      <UiButton
        appearance="solid"
        tone="primary"
        type="button"
        :disabled="disabled || !agentAvailable || !displayName.trim() || !endpoint.trim()"
        @click="createIntegration"
      >
        {{ $t('agent.settings.mcpIntegrations.create') }}
      </UiButton>

      <p v-if="loading" class="text-xs text-text-secondary">{{ $t('agent.settings.mcpIntegrations.loading') }}</p>
      <p v-else-if="integrations.length === 0" class="rounded bg-background p-3 text-xs text-text-secondary">
        {{ $t('agent.settings.mcpIntegrations.empty') }}
      </p>

      <article v-for="integration in integrations" :key="integration.id" class="rounded bg-background p-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium">{{ mcpConfiguration(integration).displayName }}</span>
              <span class="rounded border px-2 py-0.5 text-[11px] font-medium" :class="statusClass(integration)">
                {{ statusLabel(integration) }}
              </span>
            </div>
            <div class="mt-0.5 break-all font-mono text-[11px] text-text-secondary">{{ integration.id }}</div>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-3 text-xs">
            <label class="flex items-center gap-1">
              <input
                type="checkbox"
                :checked="mcpConfiguration(integration).trustToolAnnotations === true"
                :disabled="disabled"
                @change="toggleTrustAnnotations(integration, ($event.target as HTMLInputElement).checked)"
              />
              {{ $t('agent.settings.mcpIntegrations.trustAnnotations') }}
            </label>
            <label class="flex items-center gap-1">
              <input
                type="checkbox"
                :checked="integration.enabled"
                :disabled="disabled"
                @change="toggleIntegration(integration, ($event.target as HTMLInputElement).checked)"
              />
              {{ $t('agent.settings.mcpIntegrations.enabled') }}
            </label>
          </div>
        </div>

        <div class="mt-3 grid gap-2 lg:grid-cols-[2fr_1.5fr_auto]">
          <label class="text-[11px] text-text-secondary">
            {{ $t('agent.settings.mcpIntegrations.endpoint') }}
            <input
              :value="mcpConfiguration(integration).endpoint"
              class="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
              :disabled="disabled"
              @change="changeEndpoint(integration, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="text-[11px] text-text-secondary">
            {{ $t('agent.settings.mcpIntegrations.replaceCredential') }}
            <input
              v-model="credentialDrafts[integration.id]"
              type="password"
              autocomplete="new-password"
              class="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
              :disabled="disabled"
            />
          </label>
          <div class="flex flex-wrap items-end gap-2">
            <UiButton
              appearance="soft"
              tone="neutral"
              type="button"
              :disabled="disabled || !(credentialDrafts[integration.id] ?? '').trim()"
              @click="replaceCredential(integration)"
            >
              {{ $t('agent.settings.mcpIntegrations.saveCredential') }}
            </UiButton>
            <UiButton
              appearance="soft"
              tone="neutral"
              v-if="integration.hasCredential"
              type="button"
              :disabled="disabled"
              @click="clearCredential(integration)"
            >
              {{ $t('agent.settings.mcpIntegrations.clearCredential') }}
            </UiButton>
          </div>
        </div>

        <dl class="mt-3 grid gap-x-4 gap-y-1 text-[11px] text-text-secondary sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt>{{ $t('agent.settings.mcpIntegrations.lastAttempt') }}</dt>
            <dd class="text-foreground">{{ formatTime(integration.lastAttemptAt) }}</dd>
          </div>
          <div>
            <dt>{{ $t('agent.settings.mcpIntegrations.lastSuccess') }}</dt>
            <dd class="text-foreground">{{ formatTime(integration.lastSuccessAt) }}</dd>
          </div>
          <div>
            <dt>{{ $t('agent.settings.mcpIntegrations.nextRetry') }}</dt>
            <dd class="text-foreground">{{ formatTime(integration.nextRetryAt) }}</dd>
          </div>
          <div>
            <dt>{{ $t('agent.settings.mcpIntegrations.lastError') }}</dt>
            <dd class="break-all font-mono text-foreground">{{ integration.lastErrorCode ?? '—' }}</dd>
          </div>
        </dl>

        <div class="mt-3 flex flex-wrap gap-2">
          <UiButton
            appearance="soft"
            tone="neutral"
            type="button"
            :disabled="disabled || !integration.enabled || integration.refreshState === 'refreshing'"
            @click="refreshIntegration(integration)"
          >
            {{ $t('agent.settings.mcpIntegrations.retry') }}
          </UiButton>
          <UiButton
            appearance="soft"
            tone="danger"
            type="button"
            :disabled="disabled"
            @click="removeIntegration(integration)"
          >
            {{ $t('agent.settings.mcpIntegrations.delete') }}
          </UiButton>
        </div>
      </article>
    </div>
  </section>
</template>
