<script setup lang="ts">
  import { UiButton, UiCheckbox } from '@/foundation/ui';
  import { computed, onMounted, ref, watch } from 'vue';
  import { useOperationFeedback } from '@/shared/feedback/public';
  import {
    agentApi,
    formatAgentApiError,
    type AgentAcpIntegrationConfigurationDto,
    type AgentIntegrationViewDto,
    type AgentSettingsViewDto,
  } from '../api/agent-api';

  type Profile = AgentSettingsViewDto['requestedSettings']['workspaceRuntime']['acpProfiles'][number];
  interface ProfileDraft {
    id: string;
    argvText: string;
    cwd: string;
  }

  const DEFAULT_AGENT_APP_ID = 'nexus.agent';
  const props = defineProps<{ settings: AgentSettingsViewDto; busy: boolean; agentAvailable: boolean }>();
  const emit = defineEmits<{ saveProfiles: [profiles: Profile[]] }>();
  const operationFeedback = useOperationFeedback('agent.settings.acp-runtime');

  const profiles = ref<ProfileDraft[]>([]);
  const integrations = ref<AgentIntegrationViewDto[]>([]);
  const displayName = ref('');
  const profileId = ref('');
  const enabled = ref(true);
  const localBusy = ref(false);
  const loading = ref(false);
  const disabled = computed(() => props.busy || localBusy.value);
  const configuredProfiles = computed(() => props.settings.effectiveSettings.workspaceRuntime.acpProfiles);

  const acpConfiguration = (integration: AgentIntegrationViewDto): AgentAcpIntegrationConfigurationDto => {
    if (integration.kind !== 'acp' || integration.configuration.transport !== 'workspace-profile') {
      throw new Error('ACP_INTEGRATION_INVALID');
    }
    return integration.configuration as AgentAcpIntegrationConfigurationDto;
  };

  const syncProfiles = (): void => {
    profiles.value = props.settings.requestedSettings.workspaceRuntime.acpProfiles.map((profile) => ({
      id: profile.id,
      argvText: JSON.stringify(profile.argv),
      cwd: profile.cwd,
    }));
    if (!configuredProfiles.value.some((profile) => profile.id === profileId.value)) {
      profileId.value = configuredProfiles.value[0]?.id ?? '';
    }
  };

  const explain = (cause: unknown): string => formatAgentApiError(cause, 'ACP request failed.');

  const loadIntegrations = async (): Promise<void> => {
    if (!props.agentAvailable) {
      integrations.value = [];
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      integrations.value = await agentApi.integrations(DEFAULT_AGENT_APP_ID, 'acp');
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

  const addProfile = (): void => {
    let index = profiles.value.length + 1;
    let id = `acp-profile-${index}`;
    while (profiles.value.some((profile) => profile.id === id)) id = `acp-profile-${++index}`;
    profiles.value.push({ id, argvText: '["acp-agent"]', cwd: '/workspace/work' });
  };

  const removeProfile = (index: number): void => {
    profiles.value.splice(index, 1);
  };

  const saveProfiles = (): void => {
    try {
      const normalized: Profile[] = profiles.value.map((profile) => {
        const id = profile.id.trim();
        if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(id)) throw new Error('ACP_PROFILE_ID_INVALID');
        let parsed: unknown;
        try {
          parsed = JSON.parse(profile.argvText);
        } catch {
          throw new Error('ACP_PROFILE_ARGV_INVALID');
        }
        if (
          !Array.isArray(parsed) ||
          parsed.length < 1 ||
          parsed.length > 64 ||
          parsed.some((item) => typeof item !== 'string' || item.includes('\0'))
        ) {
          throw new Error('ACP_PROFILE_ARGV_INVALID');
        }
        const cwd = profile.cwd.trim();
        if (cwd !== '/workspace' && !cwd.startsWith('/workspace/')) throw new Error('ACP_PROFILE_CWD_INVALID');
        return { id, argv: parsed as string[], cwd };
      });
      if (new Set(normalized.map((profile) => profile.id)).size !== normalized.length) {
        throw new Error('ACP_PROFILE_ID_DUPLICATE');
      }
      emit('saveProfiles', normalized);
    } catch (cause) {
      operationFeedback.notifyError({ operation: 'validate-profiles', message: explain(cause), cause });
    }
  };

  const createIntegration = (): void => {
    const name = displayName.value.trim();
    const selectedProfile = profileId.value;
    if (!name || !selectedProfile) return;
    void run(
      'create-integration',
      async () => {
        await agentApi.createIntegration(DEFAULT_AGENT_APP_ID, {
          kind: 'acp',
          configuration: {
            displayName: name,
            transport: 'workspace-profile',
            profileId: selectedProfile,
            protocolVersion: '1',
          },
          enabled: enabled.value,
        });
        displayName.value = '';
        enabled.value = true;
        await loadIntegrations();
      },
      'ACP integration created.',
    );
  };

  const toggleIntegration = (integration: AgentIntegrationViewDto, nextEnabled: boolean): void => {
    const configuration = acpConfiguration(integration);
    void run(
      'toggle-integration',
      async () => {
        await agentApi.updateIntegration(DEFAULT_AGENT_APP_ID, integration, {
          kind: 'acp',
          configuration: { ...configuration },
          enabled: nextEnabled,
        });
        await loadIntegrations();
      },
      'ACP integration updated.',
    );
  };

  const changeIntegrationProfile = (integration: AgentIntegrationViewDto, nextProfileId: string): void => {
    const configuration = acpConfiguration(integration);
    if (!configuredProfiles.value.some((profile) => profile.id === nextProfileId)) return;
    void run(
      'change-integration-profile',
      async () => {
        await agentApi.updateIntegration(DEFAULT_AGENT_APP_ID, integration, {
          kind: 'acp',
          configuration: { ...configuration, profileId: nextProfileId },
          enabled: integration.enabled,
        });
        await loadIntegrations();
      },
      'ACP integration profile updated.',
    );
  };

  const removeIntegration = (integration: AgentIntegrationViewDto): void => {
    void run(
      'remove-integration',
      async () => {
        await agentApi.deleteIntegration(DEFAULT_AGENT_APP_ID, integration);
        await loadIntegrations();
      },
      'ACP integration deleted.',
    );
  };

  watch(() => props.settings.revision, syncProfiles, { immediate: true });
  onMounted(() => void loadIntegrations());
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/35">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5"
    >
      <div>
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.acpRuntime.title') }}</h3>
        <p class="mt-0.5 text-xs text-text-secondary">{{ $t('agent.settings.acpRuntime.description') }}</p>
      </div>
      <UiButton appearance="soft" tone="neutral" type="button" :disabled="disabled" @click="addProfile">
        <i class="fa-solid fa-plus text-xs" aria-hidden="true"></i>
        <span>{{ $t('agent.settings.acpRuntime.addProfile') }}</span>
      </UiButton>
    </div>
    <div class="space-y-4 p-4 sm:p-5">
      <div class="mt-4">
        <h3 class="text-sm font-semibold">{{ $t('agent.settings.acpRuntime.profiles') }}</h3>
        <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.acpRuntime.profilesHint') }}</p>
        <p v-if="profiles.length === 0" class="mt-2 rounded bg-background p-3 text-xs text-text-secondary">
          {{ $t('agent.settings.acpRuntime.noProfiles') }}
        </p>
        <article v-for="(profile, index) in profiles" :key="index" class="mt-2 rounded bg-background p-3">
          <div class="grid gap-2 md:grid-cols-[1fr_2fr_2fr_auto]">
            <label class="text-[11px] text-text-secondary">
              {{ $t('agent.settings.acpRuntime.profileId') }}
              <input
                v-model="profile.id"
                class="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
              />
            </label>
            <label class="text-[11px] text-text-secondary">
              {{ $t('agent.settings.acpRuntime.argv') }}
              <input
                v-model="profile.argvText"
                class="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
              />
            </label>
            <label class="text-[11px] text-text-secondary">
              {{ $t('agent.settings.acpRuntime.cwd') }}
              <input
                v-model="profile.cwd"
                class="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
              />
            </label>
            <div class="flex items-end">
              <UiButton
                appearance="soft"
                tone="danger"
                type="button"
                :disabled="disabled"
                @click="removeProfile(index)"
              >
                {{ $t('agent.settings.acpRuntime.remove') }}
              </UiButton>
            </div>
          </div>
        </article>
        <UiButton
          appearance="solid"
          tone="primary"
          type="button"
          :disabled="disabled"
          @click="saveProfiles"
          class="mt-3"
        >
          {{ $t('agent.settings.acpRuntime.saveProfiles') }}
        </UiButton>
      </div>

      <div class="mt-5 border-t border-border pt-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold">{{ $t('agent.settings.acpRuntime.integrations') }}</h3>
            <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.acpRuntime.integrationsHint') }}</p>
          </div>
          <UiButton
            appearance="soft"
            tone="neutral"
            type="button"
            :disabled="disabled || loading || !agentAvailable"
            @click="loadIntegrations"
          >
            {{ $t('agent.settings.acpRuntime.refresh') }}
          </UiButton>
        </div>

        <p
          v-if="!agentAvailable"
          class="mt-3 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          {{ $t('agent.settings.acpRuntime.installAgentFirst') }}
        </p>

        <div class="mt-3 grid gap-2 md:grid-cols-[2fr_2fr_auto_auto]">
          <label class="text-[11px] text-text-secondary">
            {{ $t('agent.settings.acpRuntime.displayName') }}
            <input
              v-model="displayName"
              class="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs"
            />
          </label>
          <label class="text-[11px] text-text-secondary">
            {{ $t('agent.settings.acpRuntime.integrationProfile') }}
            <select
              v-model="profileId"
              class="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="">{{ $t('agent.settings.acpRuntime.selectProfile') }}</option>
              <option v-for="profile in configuredProfiles" :key="profile.id" :value="profile.id">
                {{ profile.id }}
              </option>
            </select>
          </label>
          <label class="flex items-end gap-2 pb-1 text-xs">
            <UiCheckbox v-model="enabled" />
            <span>{{ $t('agent.settings.acpRuntime.enabled') }}</span>
          </label>
          <div class="flex items-end">
            <UiButton
              appearance="solid"
              tone="primary"
              type="button"
              :disabled="disabled || !agentAvailable || !displayName.trim() || !profileId"
              @click="createIntegration"
            >
              {{ $t('agent.settings.acpRuntime.createIntegration') }}
            </UiButton>
          </div>
        </div>

        <p v-if="configuredProfiles.length === 0" class="mt-2 text-xs text-warning">
          {{ $t('agent.settings.acpRuntime.saveProfileFirst') }}
        </p>
        <p v-if="loading" class="mt-3 text-xs text-text-secondary">{{ $t('agent.settings.acpRuntime.loading') }}</p>
        <p v-else-if="integrations.length === 0" class="mt-3 rounded bg-background p-3 text-xs text-text-secondary">
          {{ $t('agent.settings.acpRuntime.noIntegrations') }}
        </p>

        <article v-for="integration in integrations" :key="integration.id" class="mt-2 rounded bg-background p-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-medium">{{ acpConfiguration(integration).displayName }}</div>
              <div class="mt-0.5 break-all font-mono text-[11px] text-text-secondary">{{ integration.id }}</div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <select
                :value="acpConfiguration(integration).profileId"
                class="rounded border border-border bg-card px-2 py-1 text-xs"
                :disabled="disabled"
                @change="changeIntegrationProfile(integration, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="profile in configuredProfiles" :key="profile.id" :value="profile.id">
                  {{ profile.id }}
                </option>
              </select>
              <label class="flex items-center gap-1 text-xs">
                <UiCheckbox
                  :model-value="integration.enabled"
                  :disabled="disabled"
                  @update:model-value="(value: boolean) => toggleIntegration(integration, value)"
                />
                <span>{{ $t('agent.settings.acpRuntime.enabled') }}</span>
              </label>
              <UiButton
                appearance="soft"
                tone="danger"
                type="button"
                :disabled="disabled"
                @click="removeIntegration(integration)"
              >
                {{ $t('agent.settings.acpRuntime.deleteIntegration') }}
              </UiButton>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
