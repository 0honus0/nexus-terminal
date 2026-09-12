<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue';
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
  import AcpRuntimeSettings from './AcpRuntimeSettings.vue';
  import AppManagementSettings from './AppManagementSettings.vue';
  import BudgetContextSettings from './BudgetContextSettings.vue';
  import BrowserRuntimeSettings from './BrowserRuntimeSettings.vue';
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

  const groups = [
    { id: 'overview', icon: 'fa-solid fa-table-cells-large', label: 'agent.settings.groups.overview' },
    { id: 'models', icon: 'fa-solid fa-brain', label: 'agent.settings.groups.models' },
    { id: 'execution', icon: 'fa-solid fa-gauge-high', label: 'agent.settings.groups.execution' },
    { id: 'environments', icon: 'fa-solid fa-cubes', label: 'agent.settings.groups.environments' },
    { id: 'storage', icon: 'fa-solid fa-box-archive', label: 'agent.settings.groups.storage' },
    { id: 'extensions', icon: 'fa-solid fa-puzzle-piece', label: 'agent.settings.groups.extensions' },
    { id: 'safety', icon: 'fa-solid fa-shield-halved', label: 'agent.settings.groups.safety' },
  ] as const;

  const enabledApps = computed(() => apps.value.filter((app) => app.enabled).length);
  const enabledProviders = computed(() => providers.value.filter((provider) => provider.enabled).length);
  const modelCount = computed(() => providers.value.reduce((total, provider) => total + provider.models.length, 0));
  const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${bytes} B`;
  };

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

  const setDefaultModel = (providerId: string, modelId: string) =>
    patchSection('model', { defaultProviderId: providerId, defaultModelId: modelId });

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

  const scrollToGroup = (id: string): void => {
    document.getElementById(`agent-settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
      <div class="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside class="min-w-0">
          <nav
            class="sticky top-3 rounded-xl border border-border bg-card p-2 shadow-sm"
            :aria-label="$t('agent.settings.navigation')"
          >
            <div class="border-b border-border/70 px-2 pb-2 pt-1">
              <div class="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
                {{ $t('agent.settings.controlPlane') }}
              </div>
              <div class="mt-2 flex items-center gap-2 text-xs">
                <span
                  class="h-2 w-2 rounded-full"
                  :class="settings.effectiveSettings.feature.enabled ? 'bg-success' : 'bg-text-secondary/50'"
                ></span>
                <span class="font-medium">
                  {{
                    settings.effectiveSettings.feature.enabled
                      ? $t('agent.settings.enabled')
                      : $t('agent.settings.disabled')
                  }}
                </span>
              </div>
            </div>
            <div class="mt-1 space-y-0.5">
              <button
                v-for="group in groups"
                :key="group.id"
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-text-secondary hover:bg-header hover:text-foreground"
                @click="scrollToGroup(group.id)"
              >
                <i :class="`${group.icon} w-4 text-center text-[10px]`" aria-hidden="true"></i>
                <span>{{ $t(group.label) }}</span>
              </button>
            </div>
          </nav>
        </aside>

        <div class="min-w-0 space-y-8">
          <section id="agent-settings-overview" class="scroll-mt-4 space-y-4">
            <div>
              <h2 class="text-sm font-semibold">{{ $t('agent.settings.groups.overview') }}</h2>
              <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.groupDescriptions.overview') }}</p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div class="rounded-xl border border-border bg-card p-3.5">
                <div class="text-[10px] text-text-secondary">{{ $t('agent.settings.summary.apps') }}</div>
                <div class="mt-1 text-lg font-semibold">{{ enabledApps }}/{{ apps.length }}</div>
                <div class="mt-1 text-[10px] text-text-secondary">{{ $t('agent.settings.summary.enabled') }}</div>
              </div>
              <div class="rounded-xl border border-border bg-card p-3.5">
                <div class="text-[10px] text-text-secondary">{{ $t('agent.settings.summary.models') }}</div>
                <div class="mt-1 text-lg font-semibold">{{ modelCount }}</div>
                <div class="mt-1 text-[10px] text-text-secondary">
                  {{ $t('agent.settings.summary.providers', { count: enabledProviders }) }}
                </div>
              </div>
              <div class="rounded-xl border border-border bg-card p-3.5">
                <div class="text-[10px] text-text-secondary">{{ $t('agent.settings.summary.runtime') }}</div>
                <div class="mt-1 text-sm font-semibold">
                  {{
                    workspaceRuntime.available
                      ? $t('agent.settings.workspaceRuntime.available')
                      : $t('agent.settings.workspaceRuntime.unavailable')
                  }}
                </div>
                <div class="mt-1 truncate text-[10px] text-text-secondary">{{ workspaceRuntime.reason }}</div>
              </div>
              <div class="rounded-xl border border-border bg-card p-3.5">
                <div class="text-[10px] text-text-secondary">{{ $t('agent.settings.summary.storage') }}</div>
                <div class="mt-1 text-sm font-semibold">{{ formatBytes(storage.totalBytes) }}</div>
                <div class="mt-1 text-[10px] text-text-secondary">
                  {{ $t('agent.settings.summary.storageLimit', { value: formatBytes(storage.limitBytes) }) }}
                </div>
              </div>
            </div>
            <AgentFeatureSettings :settings="settings" :busy="busy" @change="changeFeature" />
            <AppManagementSettings :apps="apps" :busy="busy" @toggle="toggleApp" />
          </section>

          <section id="agent-settings-models" class="scroll-mt-4 space-y-4">
            <div>
              <h2 class="text-sm font-semibold">{{ $t('agent.settings.groups.models') }}</h2>
              <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.groupDescriptions.models') }}</p>
            </div>
            <ModelProviderSettings
              :providers="providers"
              :busy="busy"
              :default-provider-id="settings.requestedSettings.model.defaultProviderId"
              :default-model-id="settings.requestedSettings.model.defaultModelId"
              @create="createProvider"
              @toggle="toggleProvider"
              @test="testProvider"
              @default-model="setDefaultModel"
            />
            <BudgetContextSettings :settings="settings" :busy="busy" @save="(patch) => patchSection('budget', patch)" />
            <HardLimitsSettings
              :settings="settings"
              :preview="hardLimitPreview"
              :busy="busy"
              @preview="previewHardLimits"
              @confirm="confirmHardLimits"
              @dismiss="hardLimitPreview = null"
            />
          </section>

          <section id="agent-settings-execution" class="scroll-mt-4 space-y-4">
            <div>
              <h2 class="text-sm font-semibold">{{ $t('agent.settings.groups.execution') }}</h2>
              <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.groupDescriptions.execution') }}</p>
            </div>
            <PerformanceSettings
              :settings="settings"
              :busy="busy"
              @save="(patch) => patchSection('performance', patch)"
            />
            <SubagentSettings
              :settings="settings"
              :apps="apps"
              :providers="providers"
              :busy="busy"
              @save="(patch) => patchSection('subagents', patch)"
            />
          </section>

          <section id="agent-settings-environments" class="scroll-mt-4 space-y-4">
            <div>
              <h2 class="text-sm font-semibold">{{ $t('agent.settings.groups.environments') }}</h2>
              <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.groupDescriptions.environments') }}</p>
            </div>
            <WorkspaceRuntimeSettings
              :availability="workspaceRuntime"
              :settings="settings"
              :busy="busy"
              @settings-updated="(updated) => (settings = updated)"
            />
            <BrowserRuntimeSettings
              :settings="settings"
              :busy="busy"
              @save="(patch) => patchSection('browser', patch)"
            />
            <AcpRuntimeSettings
              :settings="settings"
              :busy="busy"
              @save-profiles="(profiles) => patchSection('workspaceRuntime', { acpProfiles: profiles })"
            />
          </section>

          <section id="agent-settings-storage" class="scroll-mt-4 space-y-4">
            <div>
              <h2 class="text-sm font-semibold">{{ $t('agent.settings.groups.storage') }}</h2>
              <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.groupDescriptions.storage') }}</p>
            </div>
            <StorageArtifactSettings
              :settings="settings"
              :storage="storage"
              :busy="busy"
              @save="(patch) => patchSection('storage', patch)"
            />
          </section>

          <section id="agent-settings-extensions" class="scroll-mt-4 space-y-4">
            <div>
              <h2 class="text-sm font-semibold">{{ $t('agent.settings.groups.extensions') }}</h2>
              <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.groupDescriptions.extensions') }}</p>
            </div>
            <PluginManagementSettings
              :apps="apps"
              :settings="settings"
              :busy="busy"
              @refresh="load"
              @settings-updated="(updated) => (settings = updated)"
            />
          </section>

          <section id="agent-settings-safety" class="scroll-mt-4 space-y-4">
            <div>
              <h2 class="text-sm font-semibold">{{ $t('agent.settings.groups.safety') }}</h2>
              <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.groupDescriptions.safety') }}</p>
            </div>
            <SafetyNetworkSettings :denylist="denylist" :busy="busy" @save="saveDenylist" />
            <SystemGuardrails />
          </section>
        </div>
      </div>
    </template>
  </section>
</template>
