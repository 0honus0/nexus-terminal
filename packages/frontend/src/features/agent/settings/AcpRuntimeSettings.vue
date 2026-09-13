<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue';
  import {
    agentApi,
    formatAgentApiError,
    type AgentAcpIntegrationConfiguration,
    type AgentIntegrationView,
    type AgentSettingsView,
  } from '../api/agent-api';

  type Profile = AgentSettingsView['requestedSettings']['workspaceRuntime']['acpProfiles'][number];
  interface ProfileDraft {
    id: string;
    argvText: string;
    cwd: string;
  }

  const DEFAULT_AGENT_APP_ID = 'nexus.agent';
  const props = defineProps<{ settings: AgentSettingsView; busy: boolean; agentAvailable: boolean }>();
  const emit = defineEmits<{ saveProfiles: [profiles: Profile[]] }>();

  const profiles = ref<ProfileDraft[]>([]);
  const integrations = ref<AgentIntegrationView[]>([]);
  const displayName = ref('');
  const profileId = ref('');
  const enabled = ref(true);
  const localBusy = ref(false);
  const loading = ref(false);
  const error = ref('');
  const notice = ref('');
  const disabled = computed(() => props.busy || localBusy.value);
  const configuredProfiles = computed(() => props.settings.effectiveSettings.workspaceRuntime.acpProfiles);

  const acpConfiguration = (integration: AgentIntegrationView): AgentAcpIntegrationConfiguration => {
    if (integration.kind !== 'acp' || integration.configuration.transport !== 'workspace-profile') {
      throw new Error('ACP_INTEGRATION_INVALID');
    }
    return integration.configuration as AgentAcpIntegrationConfiguration;
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
    error.value = '';
    try {
      integrations.value = await agentApi.integrations(DEFAULT_AGENT_APP_ID, 'acp');
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      loading.value = false;
    }
  };

  const run = async (action: () => Promise<void>, success = ''): Promise<void> => {
    if (disabled.value) return;
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
      error.value = '';
      emit('saveProfiles', normalized);
    } catch (cause) {
      error.value = explain(cause);
    }
  };

  const createIntegration = (): void => {
    const name = displayName.value.trim();
    const selectedProfile = profileId.value;
    if (!name || !selectedProfile) return;
    void run(async () => {
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
    }, 'ACP integration created.');
  };

  const toggleIntegration = (integration: AgentIntegrationView, nextEnabled: boolean): void => {
    const configuration = acpConfiguration(integration);
    void run(async () => {
      await agentApi.updateIntegration(DEFAULT_AGENT_APP_ID, integration, {
        kind: 'acp',
        configuration: { ...configuration },
        enabled: nextEnabled,
      });
      await loadIntegrations();
    }, 'ACP integration updated.');
  };

  const changeIntegrationProfile = (integration: AgentIntegrationView, nextProfileId: string): void => {
    const configuration = acpConfiguration(integration);
    if (!configuredProfiles.value.some((profile) => profile.id === nextProfileId)) return;
    void run(async () => {
      await agentApi.updateIntegration(DEFAULT_AGENT_APP_ID, integration, {
        kind: 'acp',
        configuration: { ...configuration, profileId: nextProfileId },
        enabled: integration.enabled,
      });
      await loadIntegrations();
    }, 'ACP integration profile updated.');
  };

  const removeIntegration = (integration: AgentIntegrationView): void => {
    void run(async () => {
      await agentApi.deleteIntegration(DEFAULT_AGENT_APP_ID, integration);
      await loadIntegrations();
    }, 'ACP integration deleted.');
  };

  watch(() => props.settings.revision, syncProfiles, { immediate: true });
  onMounted(() => void loadIntegrations());
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">{{ $t('agent.settings.acpRuntime.title') }}</h2>
        <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.acpRuntime.description') }}</p>
      </div>
      <button
        type="button"
        class="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50"
        :disabled="disabled"
        @click="addProfile"
      >
        {{ $t('agent.settings.acpRuntime.addProfile') }}
      </button>
    </div>

    <div v-if="error" class="mt-3 rounded border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
      {{ error }}
    </div>
    <div v-if="notice" class="mt-3 rounded border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
      {{ notice }}
    </div>

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
            <button
              type="button"
              class="rounded border border-error/40 px-2 py-1 text-xs text-error disabled:opacity-50"
              :disabled="disabled"
              @click="removeProfile(index)"
            >
              {{ $t('agent.settings.acpRuntime.remove') }}
            </button>
          </div>
        </div>
      </article>
      <button
        type="button"
        class="mt-3 rounded bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50"
        :disabled="disabled"
        @click="saveProfiles"
      >
        {{ $t('agent.settings.acpRuntime.saveProfiles') }}
      </button>
    </div>

    <div class="mt-5 border-t border-border pt-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold">{{ $t('agent.settings.acpRuntime.integrations') }}</h3>
          <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.acpRuntime.integrationsHint') }}</p>
        </div>
        <button
          type="button"
          class="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
          :disabled="disabled || loading || !agentAvailable"
          @click="loadIntegrations"
        >
          {{ $t('agent.settings.acpRuntime.refresh') }}
        </button>
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
          <select v-model="profileId" class="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs">
            <option value="">{{ $t('agent.settings.acpRuntime.selectProfile') }}</option>
            <option v-for="profile in configuredProfiles" :key="profile.id" :value="profile.id">
              {{ profile.id }}
            </option>
          </select>
        </label>
        <label class="flex items-end gap-2 pb-1 text-xs">
          <input v-model="enabled" type="checkbox" />{{ $t('agent.settings.acpRuntime.enabled') }}
        </label>
        <div class="flex items-end">
          <button
            type="button"
            class="rounded bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50"
            :disabled="disabled || !agentAvailable || !displayName.trim() || !profileId"
            @click="createIntegration"
          >
            {{ $t('agent.settings.acpRuntime.createIntegration') }}
          </button>
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
            <div class="mt-0.5 break-all font-mono text-[10px] text-text-secondary">{{ integration.id }}</div>
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
              <input
                type="checkbox"
                :checked="integration.enabled"
                :disabled="disabled"
                @change="toggleIntegration(integration, ($event.target as HTMLInputElement).checked)"
              />
              {{ $t('agent.settings.acpRuntime.enabled') }}
            </label>
            <button
              type="button"
              class="rounded border border-error/40 px-2 py-1 text-xs text-error disabled:opacity-50"
              :disabled="disabled"
              @click="removeIntegration(integration)"
            >
              {{ $t('agent.settings.acpRuntime.deleteIntegration') }}
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
