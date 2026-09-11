<script setup lang="ts">
  import { onMounted, ref } from 'vue';
  import {
    agentApi,
    formatAgentApiError,
    type AgentAppSummary,
    type AgentHardLimits,
    type AgentProviderView,
    type AgentSettingsView,
    type ArtifactStorageSummary,
    type WorkspaceRuntimeAvailability,
    type HardLimitPreview,
    type TargetDenylistView,
  } from '../api/agent-api';
  import AgentFeatureSettings from './AgentFeatureSettings.vue';
  import AppManagementSettings from './AppManagementSettings.vue';
  import BudgetContextSettings from './BudgetContextSettings.vue';
  import WorkspaceRuntimeSettings from './WorkspaceRuntimeSettings.vue';
  import HardLimitsSettings from './HardLimitsSettings.vue';
  import ModelProviderSettings from './ModelProviderSettings.vue';
  import PerformanceSettings from './PerformanceSettings.vue';
  import PluginManagementSettings from './PluginManagementSettings.vue';
  import SafetyNetworkSettings from './SafetyNetworkSettings.vue';
  import StorageArtifactSettings from './StorageArtifactSettings.vue';
  import SubagentSettings from './SubagentSettings.vue';
  import SystemGuardrails from './SystemGuardrails.vue';

  const settings = ref<AgentSettingsView | null>(null);
  const apps = ref<AgentAppSummary[]>([]);
  const providers = ref<AgentProviderView[]>([]);
  const storage = ref<ArtifactStorageSummary | null>(null);
  const workspaceRuntime = ref<WorkspaceRuntimeAvailability | null>(null);
  const denylist = ref<TargetDenylistView | null>(null);
  const hardLimitPreview = ref<HardLimitPreview | null>(null);
  const loading = ref(true);
  const busy = ref(false);
  const error = ref('');
  const notice = ref('');

  const message = (cause: unknown): string => formatAgentApiError(cause, 'Agent request failed.');

  const load = async () => {
    loading.value = true;
    error.value = '';
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
      error.value = message(cause);
    } finally {
      loading.value = false;
    }
  };

  const execute = async (action: () => Promise<void>, success?: string) => {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
      await action();
      if (success) notice.value = success;
    } catch (cause) {
      error.value = message(cause);
    } finally {
      busy.value = false;
    }
  };

  const patchSection = (section: string, patch: Record<string, unknown>) =>
    execute(async () => {
      if (!settings.value) return;
      settings.value = await agentApi.patchSettings({ [section]: patch }, settings.value.revision);
      storage.value = await agentApi.storage();
    });

  const changeFeature = (enabled: boolean) => patchSection('feature', { enabled });

  const toggleApp = (app: AgentAppSummary, enabled: boolean) =>
    execute(async () => {
      const updated = await agentApi.setAppEnabled(app, enabled);
      apps.value = apps.value.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    });

  const previewHardLimits = (proposed: Partial<AgentHardLimits>) =>
    execute(async () => {
      if (!settings.value) return;
      hardLimitPreview.value = await agentApi.previewHardLimits(proposed, settings.value.revision);
    });

  const confirmHardLimits = (confirmationId: string, expectedVersion: number) =>
    execute(async () => {
      settings.value = await agentApi.confirmHardLimits(confirmationId, expectedVersion);
      hardLimitPreview.value = null;
      storage.value = await agentApi.storage();
    });

  const createProvider = (input: Record<string, unknown>) =>
    execute(async () => {
      await agentApi.createProvider(input);
      providers.value = await agentApi.providers();
      apps.value = await agentApi.apps();
    });

  const toggleProvider = (provider: AgentProviderView, enabled: boolean) =>
    execute(async () => {
      const updated = await agentApi.updateProvider(provider, { enabled });
      providers.value = providers.value.map((candidate) => (candidate.id === updated.id ? updated : candidate));
      apps.value = await agentApi.apps();
    });

  const testProvider = (provider: AgentProviderView, modelId: string) =>
    execute(async () => {
      const result = await agentApi.testProvider(provider.id, modelId);
      if (!result.ok) throw new Error('Provider test failed.');
      notice.value = `Provider OK · ${result.latencyMs} ms`;
    });

  const saveDenylist = (connectionIds: number[], reason: string) =>
    execute(async () => {
      if (!denylist.value) return;
      denylist.value = await agentApi.replaceTargetDenylist(connectionIds, reason, denylist.value.revision);
    });

  onMounted(load);
</script>

<template>
  <section id="settings-panel-agent" class="space-y-5" aria-labelledby="settings-agent-title">
    <div>
      <h1 id="settings-agent-title" class="text-xl font-semibold">{{ $t('agent.settings.title') }}</h1>
      <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.description') }}</p>
    </div>

    <div v-if="error" class="rounded-md border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
      {{ error }}
    </div>
    <div v-if="notice" class="rounded-md border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
      {{ notice }}
    </div>
    <div v-if="loading" class="rounded-lg border border-border bg-card p-8 text-center text-sm text-text-secondary">
      {{ $t('agent.settings.loading') }}
    </div>

    <template v-else-if="settings && storage && workspaceRuntime && denylist">
      <AgentFeatureSettings :settings="settings" :busy="busy" @change="changeFeature" />
      <AppManagementSettings :apps="apps" :busy="busy" @toggle="toggleApp" />
      <PluginManagementSettings :apps="apps" :busy="busy" @refresh="load" />
      <ModelProviderSettings
        :providers="providers"
        :busy="busy"
        @create="createProvider"
        @toggle="toggleProvider"
        @test="testProvider"
      />
      <PerformanceSettings :settings="settings" :busy="busy" @save="(patch) => patchSection('performance', patch)" />
      <BudgetContextSettings :settings="settings" :busy="busy" @save="(patch) => patchSection('budget', patch)" />
      <HardLimitsSettings
        :settings="settings"
        :preview="hardLimitPreview"
        :busy="busy"
        @preview="previewHardLimits"
        @confirm="confirmHardLimits"
        @dismiss="hardLimitPreview = null"
      />
      <SubagentSettings
        :settings="settings"
        :apps="apps"
        :providers="providers"
        :busy="busy"
        @save="(patch) => patchSection('subagents', patch)"
      />
      <StorageArtifactSettings
        :settings="settings"
        :storage="storage"
        :busy="busy"
        @save="(patch) => patchSection('storage', patch)"
      />
      <WorkspaceRuntimeSettings
        :availability="workspaceRuntime"
        :settings="settings"
        :busy="busy"
        @settings-updated="(updated) => (settings = updated)"
      />
      <SafetyNetworkSettings :denylist="denylist" :busy="busy" @save="saveDenylist" />
      <SystemGuardrails />
    </template>
  </section>
</template>
