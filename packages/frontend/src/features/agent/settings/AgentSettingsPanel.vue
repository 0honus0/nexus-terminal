<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import BaseModal from '@/foundation/ui/BaseModal.vue';
  import {
    agentApi,
    formatAgentApiError,
    type AgentAppSummary,
    type AgentDiscoveredProviderModel,
    type AgentHardLimits,
    type AgentProviderView,
    type AgentSettingsView,
    type ArtifactStorageSummary,
    type WorkspaceRuntimeAvailability,
    type HardLimitPreview,
    type RecommendedAgentPluginView,
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

  const { t } = useI18n();
  const settings = ref<AgentSettingsView | null>(null);
  const apps = ref<AgentAppSummary[]>([]);
  const providers = ref<AgentProviderView[]>([]);
  const discoveredModels = ref<Record<string, AgentDiscoveredProviderModel[]>>({});
  const storage = ref<ArtifactStorageSummary | null>(null);
  const workspaceRuntime = ref<WorkspaceRuntimeAvailability | null>(null);
  const denylist = ref<TargetDenylistView | null>(null);
  const hardLimitPreview = ref<HardLimitPreview | null>(null);
  const loading = ref(true);
  const busy = ref(false);
  const error = ref('');
  const notice = ref('');
  const recommendedPlugin = ref<RecommendedAgentPluginView | null>(null);
  const onboardingVisible = ref(false);

  const groups = [
    { id: 'overview', icon: 'fa-solid fa-table-cells-large', label: 'agent.settings.groups.overview' },
    { id: 'models', icon: 'fa-solid fa-brain', label: 'agent.settings.groups.models' },
    { id: 'execution', icon: 'fa-solid fa-gauge-high', label: 'agent.settings.groups.execution' },
    { id: 'environments', icon: 'fa-solid fa-cubes', label: 'agent.settings.groups.environments' },
    { id: 'storage', icon: 'fa-solid fa-box-archive', label: 'agent.settings.groups.storage' },
    { id: 'extensions', icon: 'fa-solid fa-puzzle-piece', label: 'agent.settings.groups.extensions' },
    { id: 'safety', icon: 'fa-solid fa-shield-halved', label: 'agent.settings.groups.safety' },
  ] as const;

  type AgentSettingsGroupId = (typeof groups)[number]['id'];

  const workspaceBody = ref<HTMLElement | null>(null);
  const groupScroll = new Map<string, number>();
  const activeGroup = ref<AgentSettingsGroupId>('overview');
  const activeGroupMeta = computed(() => groups.find((group) => group.id === activeGroup.value) ?? groups[0]);

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
      notice.value = success ?? t('agent.ui.saved');
      return true;
    } catch (cause) {
      error.value = message(cause);
      return false;
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

  const changeFeature = (enabled: boolean): void => {
    if (!enabled) {
      patchSection('feature', { enabled: false });
      return;
    }
    void execute(async () => {
      if (!settings.value) return;
      const recommendation = await agentApi.recommendedPlugin();
      if (recommendation.installed) {
        if (!recommendation.enabled) {
          await agentApi.installRecommendedPlugin();
          apps.value = await agentApi.apps();
        }
        settings.value = await agentApi.patchSettings({ feature: { enabled: true } }, settings.value.revision);
        return;
      }
      recommendedPlugin.value = recommendation;
      onboardingVisible.value = true;
    });
  };

  const confirmRecommendedInstall = (): void => {
    void execute(async () => {
      if (!settings.value) return;
      await agentApi.installRecommendedPlugin();
      settings.value = await agentApi.patchSettings({ feature: { enabled: true } }, settings.value.revision);
      apps.value = await agentApi.apps();
      onboardingVisible.value = false;
      recommendedPlugin.value = null;
    });
  };

  const closeOnboarding = (): void => {
    if (busy.value) return;
    onboardingVisible.value = false;
    recommendedPlugin.value = null;
  };

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

  const setProviderProtocol = (provider: AgentProviderView, protocol: AgentProviderView['protocol']) =>
    execute(async () => {
      const updated = await agentApi.updateProvider(provider, { protocol });
      providers.value = providers.value.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    });

  const setDefaultModel = (providerId: string, modelId: string) =>
    patchSection('model', { defaultProviderId: providerId, defaultModelId: modelId });

  const discoverProviderModels = (provider: AgentProviderView) =>
    execute(async () => {
      discoveredModels.value = {
        ...discoveredModels.value,
        [provider.id]: await agentApi.discoverProviderModels(provider.id),
      };
    });

  const addProviderModel = (provider: AgentProviderView, model: AgentProviderView['models'][number]) =>
    execute(async () => {
      if (provider.models.some((candidate) => candidate.id === model.id)) return;
      const updated = await agentApi.updateProvider(provider, { models: [...provider.models, model] });
      providers.value = providers.value.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    });

  const saveDenylist = (connectionIds: number[], reason: string) =>
    execute(async () => {
      if (!denylist.value) return;
      denylist.value = await agentApi.replaceTargetDenylist(connectionIds, reason, denylist.value.revision);
    });

  const selectGroup = (id: AgentSettingsGroupId): void => {
    if (activeGroup.value === id) return;
    if (workspaceBody.value) groupScroll.set(activeGroup.value, workspaceBody.value.scrollTop);
    activeGroup.value = id;
    error.value = '';
    notice.value = '';
    requestAnimationFrame(() => {
      if (workspaceBody.value) workspaceBody.value.scrollTop = groupScroll.get(id) ?? 0;
    });
  };

  onMounted(load);
</script>

<template>
  <section
    id="settings-panel-agent"
    class="mx-auto w-full max-w-[1320px] space-y-5 pb-8"
    aria-labelledby="settings-agent-title"
  >
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <h1 id="settings-agent-title" class="text-2xl font-semibold tracking-tight">
          {{ $t('agent.settings.title') }}
        </h1>
        <p class="mt-1.5 max-w-3xl text-sm leading-6 text-text-secondary">{{ $t('agent.settings.description') }}</p>
      </div>
      <div
        v-if="settings"
        class="inline-flex shrink-0 items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-xs"
      >
        <span
          class="h-2 w-2 rounded-full"
          :class="settings.effectiveSettings.feature.enabled ? 'bg-success' : 'bg-text-secondary/50'"
        ></span>
        <span class="font-medium">
          {{
            settings.effectiveSettings.feature.enabled ? $t('agent.settings.enabled') : $t('agent.settings.disabled')
          }}
        </span>
      </div>
    </div>

    <div v-if="loading" class="rounded-lg border border-border bg-card p-8 text-center text-sm text-text-secondary">
      {{ $t('agent.settings.loading') }}
    </div>

    <p v-if="!settings && error" role="alert" class="text-sm text-error">{{ error }}</p>

    <template v-else-if="settings && storage && workspaceRuntime && denylist">
      <div class="agent-settings-shell overflow-hidden rounded-2xl border border-border/70 bg-card">
        <nav
          class="hidden shrink-0 flex-wrap gap-1 border-b border-border/60 bg-header/30 p-2 sm:flex"
          :aria-label="$t('agent.settings.navigation')"
        >
          <button
            v-for="group in groups"
            :key="group.id"
            type="button"
            class="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary"
            :class="
              activeGroup === group.id
                ? 'bg-primary/10 font-semibold text-primary'
                : 'text-text-secondary hover:bg-header'
            "
            :aria-current="activeGroup === group.id ? 'page' : undefined"
            :aria-controls="`agent-settings-${group.id}`"
            @click="selectGroup(group.id)"
          >
            <i :class="group.icon" class="text-xs" aria-hidden="true"></i>
            {{ $t(group.label) }}
          </button>
        </nav>
        <label class="block shrink-0 border-b border-border/60 bg-header/20 p-3 sm:hidden">
          <span class="sr-only">{{ $t('agent.settings.navigation') }}</span>
          <select
            :value="activeGroup"
            class="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
            @change="selectGroup(($event.target as HTMLSelectElement).value as AgentSettingsGroupId)"
          >
            <option v-for="group in groups" :key="group.id" :value="group.id">{{ $t(group.label) }}</option>
          </select>
        </label>
        <div
          ref="workspaceBody"
          class="agent-settings-body min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-6"
        >
          <div id="agent-settings-workspace" class="mb-5">
            <h2 class="text-lg font-semibold">{{ $t(activeGroupMeta.label) }}</h2>
            <p class="mt-1 text-sm leading-6 text-text-secondary">
              {{ $t(`agent.settings.groupDescriptions.${activeGroup}`) }}
            </p>
          </div>
          <section v-show="activeGroup === 'overview'" id="agent-settings-overview" class="scroll-mt-4 space-y-5">
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div class="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm">
                <div class="text-xs text-text-secondary">{{ $t('agent.settings.summary.apps') }}</div>
                <div class="mt-1 text-xl font-semibold tracking-tight">{{ enabledApps }}/{{ apps.length }}</div>
                <div class="mt-1 text-[10px] text-text-secondary">{{ $t('agent.settings.summary.enabled') }}</div>
              </div>
              <div class="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm">
                <div class="text-xs text-text-secondary">{{ $t('agent.settings.summary.models') }}</div>
                <div class="mt-1 text-xl font-semibold tracking-tight">{{ modelCount }}</div>
                <div class="mt-1 text-[10px] text-text-secondary">
                  {{ $t('agent.settings.summary.providers', { count: enabledProviders }) }}
                </div>
              </div>
              <div class="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm">
                <div class="text-xs text-text-secondary">{{ $t('agent.settings.summary.runtime') }}</div>
                <div class="mt-1 text-base font-semibold">
                  {{
                    workspaceRuntime.available
                      ? $t('agent.settings.workspaceRuntime.available')
                      : $t('agent.settings.workspaceRuntime.unavailable')
                  }}
                </div>
                <div class="mt-1 truncate text-xs text-text-secondary">{{ workspaceRuntime.reason }}</div>
              </div>
              <div class="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm">
                <div class="text-xs text-text-secondary">{{ $t('agent.settings.summary.storage') }}</div>
                <div class="mt-1 text-base font-semibold">{{ formatBytes(storage.totalBytes) }}</div>
                <div class="mt-1 text-[10px] text-text-secondary">
                  {{ $t('agent.settings.summary.storageLimit', { value: formatBytes(storage.limitBytes) }) }}
                </div>
              </div>
            </div>
            <AgentFeatureSettings :settings="settings" :busy="busy" @change="changeFeature" />
            <AppManagementSettings :apps="apps" :busy="busy" @toggle="toggleApp" />
          </section>

          <section v-show="activeGroup === 'models'" id="agent-settings-models" class="scroll-mt-4 space-y-5">
            <ModelProviderSettings
              :providers="providers"
              :busy="busy"
              :discoveries="discoveredModels"
              :default-provider-id="settings.requestedSettings.model.defaultProviderId"
              :default-model-id="settings.requestedSettings.model.defaultModelId"
              :create-provider="createProvider"
              @toggle="toggleProvider"
              @protocol="setProviderProtocol"
              @discover="discoverProviderModels"
              :add-provider-model="addProviderModel"
              @default-model="setDefaultModel"
            />
            <details class="rounded-xl border border-border/60 p-4">
              <summary class="cursor-pointer text-sm font-medium">{{ $t('agent.ui.budget') }}</summary>
              <BudgetContextSettings
                :settings="settings"
                :busy="busy"
                @save="(patch) => patchSection('budget', patch)"
              />
            </details>
            <details class="rounded-xl border border-border/60 p-4">
              <summary class="cursor-pointer text-sm font-medium">{{ $t('agent.ui.limits') }}</summary>
              <HardLimitsSettings
                :settings="settings"
                :preview="hardLimitPreview"
                :busy="busy"
                @preview="previewHardLimits"
                @confirm="confirmHardLimits"
                @dismiss="hardLimitPreview = null"
              />
            </details>
          </section>

          <section v-show="activeGroup === 'execution'" id="agent-settings-execution" class="scroll-mt-4 space-y-5">
            <PerformanceSettings
              :settings="settings"
              :busy="busy"
              @save="(patch) => patchSection('performance', patch)"
            />
            <details class="rounded-xl border border-border/60 p-4">
              <summary class="cursor-pointer text-sm font-medium">{{ $t('agent.settings.subagents.title') }}</summary>
              <SubagentSettings
                :settings="settings"
                :apps="apps"
                :providers="providers"
                :busy="busy"
                @save="(patch) => patchSection('subagents', patch)"
              />
            </details>
          </section>

          <section
            v-show="activeGroup === 'environments'"
            id="agent-settings-environments"
            class="scroll-mt-4 space-y-5"
          >
            <WorkspaceRuntimeSettings
              :availability="workspaceRuntime"
              :settings="settings"
              :busy="busy"
              @settings-updated="(updated) => (settings = updated)"
            />
            <details class="rounded-xl border border-border/60 p-4">
              <summary class="cursor-pointer text-sm font-medium">
                {{ $t('agent.settings.browserRuntime.title') }}
              </summary>
              <BrowserRuntimeSettings
                :settings="settings"
                :busy="busy"
                @save="(patch) => patchSection('browser', patch)"
              />
            </details>
            <details class="rounded-xl border border-border/60 p-4">
              <summary class="cursor-pointer text-sm font-medium">{{ $t('agent.settings.acpRuntime.title') }}</summary>
              <AcpRuntimeSettings
                :settings="settings"
                :busy="busy"
                :agent-available="apps.some((app) => app.id === 'nexus.agent')"
                @save-profiles="(profiles) => patchSection('workspaceRuntime', { acpProfiles: profiles })"
              />
            </details>
          </section>

          <section v-show="activeGroup === 'storage'" id="agent-settings-storage" class="scroll-mt-4 space-y-5">
            <StorageArtifactSettings
              :settings="settings"
              :storage="storage"
              :busy="busy"
              @save="(patch) => patchSection('storage', patch)"
            />
          </section>

          <section v-show="activeGroup === 'extensions'" id="agent-settings-extensions" class="scroll-mt-4 space-y-5">
            <PluginManagementSettings
              :apps="apps"
              :settings="settings"
              :busy="busy"
              @refresh="load"
              @settings-updated="(updated) => (settings = updated)"
            />
          </section>

          <section v-show="activeGroup === 'safety'" id="agent-settings-safety" class="scroll-mt-4 space-y-5">
            <SafetyNetworkSettings :denylist="denylist" :busy="busy" @save="saveDenylist" />
            <details class="rounded-xl border border-border/60 p-4">
              <summary class="cursor-pointer text-sm font-medium">{{ $t('agent.settings.guardrails.title') }}</summary>
              <SystemGuardrails />
            </details>
          </section>
        </div>
        <div
          v-if="error || notice || busy"
          class="shrink-0 border-t border-border/60 px-5 py-3 text-sm"
          :class="error ? 'text-error bg-error/5' : 'text-text-secondary bg-header/30'"
          :role="error ? 'alert' : 'status'"
          aria-live="polite"
        >
          {{ error || (busy ? $t('agent.ui.working') : notice) }}
        </div>
      </div>
    </template>
  </section>

  <BaseModal
    :visible="onboardingVisible && Boolean(recommendedPlugin)"
    :title="$t('agent.settings.onboarding.title')"
    :aria-label="$t('agent.settings.onboarding.title')"
    :close-on-backdrop="!busy"
    :close-on-escape="!busy"
    :focus-on-open="true"
    :restore-focus="true"
    panel-class="max-w-lg p-5"
    @close="closeOnboarding"
  >
    <template v-if="recommendedPlugin">
      <div class="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i>
        </div>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold">{{ recommendedPlugin.displayName }}</span>
            <span class="rounded-md bg-header px-2 py-0.5 text-[10px]">v{{ recommendedPlugin.availableVersion }}</span>
          </div>
          <p class="mt-1 text-sm leading-5 text-text-secondary">{{ recommendedPlugin.description }}</p>
        </div>
      </div>
      <p class="mt-4 text-sm leading-6 text-text-secondary">
        {{ $t('agent.settings.onboarding.description') }}
      </p>
      <div class="mt-4 rounded-lg border border-border/60 bg-background p-3 text-xs text-text-secondary">
        <div class="font-medium text-foreground">{{ $t('agent.settings.onboarding.verifiedPublisher') }}</div>
        <div class="mt-1 break-all font-mono text-[10px]">{{ recommendedPlugin.publisherKeyId }}</div>
        <div class="mt-2 break-all text-[10px]">{{ recommendedPlugin.catalogUrl }}</div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-border px-3 py-2 text-sm hover:bg-header disabled:opacity-50"
          :disabled="busy"
          @click="closeOnboarding"
        >
          {{ $t('agent.settings.onboarding.cancel') }}
        </button>
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="busy"
          @click="confirmRecommendedInstall"
        >
          {{ busy ? $t('agent.settings.onboarding.installing') : $t('agent.settings.onboarding.installAndEnable') }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
  .agent-settings-shell {
    display: flex;
    flex-direction: column;
    height: clamp(420px, calc(100dvh - 290px), 900px);
  }
  .agent-settings-body {
    scrollbar-gutter: stable;
    overflow-anchor: none;
  }
  .agent-settings-body :deep(section) {
    box-shadow: none;
    border-radius: 12px;
  }
  .agent-settings-body :deep(details > section) {
    border: 0;
    padding: 16px 0 0;
  }
  .agent-settings-body :deep(p) {
    overflow-wrap: anywhere;
  }
  .agent-settings-body :deep(input:not([type='checkbox']):not([type='radio'])),
  .agent-settings-body :deep(select) {
    max-width: 100%;
    min-width: 0;
  }
  @media (max-width: 640px) {
    .agent-settings-shell {
      height: max(480px, calc(100dvh - 240px));
    }
    nav button {
      flex: 1 0 42%;
      justify-content: flex-start;
    }
  }
</style>
