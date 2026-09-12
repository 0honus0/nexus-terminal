<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    agentApi,
    formatAgentApiError,
    type AgentSettingsView,
    type WorkspaceRuntimeAvailability,
    type WorkspaceRuntimeCatalog,
    type ToolchainCatalogPack,
    type WorkspaceRuntimeCommandView,
    type ToolchainPackUninstallPreview,
    type WorkspaceRuntimeCleanupPreview,
    type WorkspaceRuntimeSettingsResetPreview,
    type WorkspaceRuntimeSetupPreview,
    type WorkspaceRuntimeStorageView,
  } from '../api/agent-api';

  const props = defineProps<{
    availability: WorkspaceRuntimeAvailability;
    settings: AgentSettingsView;
    busy: boolean;
  }>();
  const emit = defineEmits<{ settingsUpdated: [settings: AgentSettingsView] }>();
  const { t } = useI18n();

  const catalog = ref<WorkspaceRuntimeCatalog | null>(null);
  const storage = ref<WorkspaceRuntimeStorageView | null>(null);
  const loading = ref(false);
  const localBusy = ref(false);
  const error = ref('');
  const notice = ref('');
  const selectedRecipeIds = ref<string[]>([]);
  const setupPreview = ref<WorkspaceRuntimeSetupPreview | null>(null);
  const uninstallPreview = ref<ToolchainPackUninstallPreview | null>(null);
  const cleanupPreview = ref<WorkspaceRuntimeCleanupPreview | null>(null);
  const resetPreview = ref<WorkspaceRuntimeSettingsResetPreview | null>(null);
  const lastCommand = ref<WorkspaceRuntimeCommandView | null>(null);

  const disabled = computed(() => props.busy || localBusy.value);
  const requested = computed(() => props.settings.requestedSettings.workspaceRuntime);

  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
  };

  const errorMessage = (cause: unknown): string =>
    formatAgentApiError(cause, t('agent.settings.workspaceRuntime.requestFailed'));

  const syncSelection = () => {
    selectedRecipeIds.value = [...requested.value.enabledRecipeIds];
  };

  const loadDetails = async () => {
    if (!props.availability.available) {
      catalog.value = null;
      storage.value = null;
      return;
    }
    loading.value = true;
    error.value = '';
    try {
      [catalog.value, storage.value] = await Promise.all([
        agentApi.workspaceRuntimeCatalog(),
        agentApi.workspaceRuntimeStorage(),
      ]);
    } catch (cause) {
      error.value = errorMessage(cause);
    } finally {
      loading.value = false;
    }
  };

  const run = async (action: () => Promise<void>) => {
    if (disabled.value) return;
    localBusy.value = true;
    error.value = '';
    notice.value = '';
    try {
      await action();
    } catch (cause) {
      error.value = errorMessage(cause);
    } finally {
      localBusy.value = false;
    }
  };

  const refreshObserved = async () => {
    await loadDetails();
    if (lastCommand.value && ['pending', 'running'].includes(lastCommand.value.status)) {
      lastCommand.value = await agentApi.workspaceRuntimeCommand(lastCommand.value.id);
    }
  };

  const toggleRecipe = (recipeId: string) => {
    selectedRecipeIds.value = selectedRecipeIds.value.includes(recipeId)
      ? selectedRecipeIds.value.filter((id) => id !== recipeId)
      : [...selectedRecipeIds.value, recipeId].sort();
    setupPreview.value = null;
  };

  const previewSetup = () =>
    run(async () => {
      if (!selectedRecipeIds.value.length) throw new Error(t('agent.settings.workspaceRuntime.selectRecipe'));
      setupPreview.value = await agentApi.previewWorkspaceRuntimeSetup(
        selectedRecipeIds.value.map((recipeId) => ({ recipeId })),
        props.settings.revision,
      );
    });

  const confirmSetup = () =>
    run(async () => {
      if (!setupPreview.value) return;
      lastCommand.value = await agentApi.confirmWorkspaceRuntimeSetup(
        setupPreview.value.confirmationId,
        setupPreview.value.expectedVersion,
      );
      setupPreview.value = null;
      emit('settingsUpdated', await agentApi.settings());
      await loadDetails();
      notice.value = t('agent.settings.workspaceRuntime.setupSubmitted');
    });

  const familyConfig = (pack: ToolchainCatalogPack) =>
    requested.value.toolVersions[pack.familyId] ?? { enabledVersionIds: [], defaultVersionId: null };
  const isDesiredEnabled = (pack: ToolchainCatalogPack) =>
    familyConfig(pack).enabledVersionIds.includes(pack.versionId);
  const isDesiredDefault = (pack: ToolchainCatalogPack) => familyConfig(pack).defaultVersionId === pack.versionId;

  const savePackPreference = (pack: ToolchainCatalogPack, mode: 'toggle' | 'default') =>
    run(async () => {
      const next = structuredClone(requested.value);
      const current = next.toolVersions[pack.familyId] ?? { enabledVersionIds: [], defaultVersionId: null };
      const enabled = new Set(current.enabledVersionIds);
      if (mode === 'default') enabled.add(pack.versionId);
      else if (enabled.has(pack.versionId)) enabled.delete(pack.versionId);
      else enabled.add(pack.versionId);
      const enabledVersionIds = [...enabled].sort();
      next.toolVersions[pack.familyId] = {
        enabledVersionIds,
        defaultVersionId:
          mode === 'default'
            ? pack.versionId
            : current.defaultVersionId && enabled.has(current.defaultVersionId)
              ? current.defaultVersionId
              : (enabledVersionIds[0] ?? null),
      };
      const updated = await agentApi.patchSettings({ workspaceRuntime: next }, props.settings.revision);
      emit('settingsUpdated', updated);
      notice.value = t('agent.settings.workspaceRuntime.preferencesSaved');
    });

  const installPack = (pack: ToolchainCatalogPack) =>
    run(async () => {
      lastCommand.value = await agentApi.installToolchainPack(pack.familyId, pack.versionId);
      await loadDetails();
      notice.value = t('agent.settings.workspaceRuntime.installSubmitted');
    });

  const previewUninstall = (pack: ToolchainCatalogPack) =>
    run(async () => {
      uninstallPreview.value = await agentApi.previewToolchainPackUninstall(
        pack.familyId,
        pack.versionId,
        props.settings.revision,
      );
    });

  const confirmUninstall = () =>
    run(async () => {
      const preview = uninstallPreview.value;
      if (!preview) return;
      lastCommand.value = await agentApi.confirmToolchainPackUninstall(
        preview.pack.familyId,
        preview.pack.versionId,
        preview.confirmationId,
        preview.expectedVersion,
      );
      uninstallPreview.value = null;
      emit('settingsUpdated', await agentApi.settings());
      await loadDetails();
      notice.value = t('agent.settings.workspaceRuntime.uninstallSubmitted');
    });

  const previewRuntimeCleanup = () =>
    run(async () => {
      cleanupPreview.value = await agentApi.previewWorkspaceRuntimeCleanup(props.settings.revision);
    });

  const confirmRuntimeCleanup = () =>
    run(async () => {
      if (!cleanupPreview.value) return;
      lastCommand.value = await agentApi.confirmWorkspaceRuntimeCleanup(
        cleanupPreview.value.confirmationId,
        cleanupPreview.value.expectedVersion,
      );
      cleanupPreview.value = null;
      await loadDetails();
      notice.value = t('agent.settings.workspaceRuntime.cleanupSubmitted');
    });

  const cleanupCache = () =>
    run(async () => {
      lastCommand.value = await agentApi.cleanupWorkspaceRuntimeCache();
      await loadDetails();
      notice.value = t('agent.settings.workspaceRuntime.cacheSubmitted');
    });

  const previewReset = () =>
    run(async () => {
      resetPreview.value = await agentApi.previewWorkspaceRuntimeSettingsReset(props.settings.revision);
    });

  const confirmReset = () =>
    run(async () => {
      if (!resetPreview.value) return;
      const updated = await agentApi.confirmWorkspaceRuntimeSettingsReset(
        resetPreview.value.confirmationId,
        resetPreview.value.expectedVersion,
      );
      resetPreview.value = null;
      emit('settingsUpdated', updated);
      syncSelection();
      notice.value = t('agent.settings.workspaceRuntime.resetComplete');
    });

  watch(() => props.settings.revision, syncSelection);
  watch(() => props.availability.available, loadDetails);
  onMounted(() => {
    syncSelection();
    void loadDetails();
  });
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">{{ $t('agent.settings.workspaceRuntime.title') }}</h2>
        <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.workspaceRuntime.description') }}</p>
      </div>
      <button
        v-if="availability.available"
        type="button"
        class="rounded border border-border px-3 py-1.5 text-xs hover:bg-background disabled:opacity-50"
        :disabled="disabled || loading"
        @click="refreshObserved"
      >
        {{ $t('agent.settings.workspaceRuntime.refresh') }}
      </button>
    </div>

    <div class="mt-4 rounded-md bg-background p-4">
      <div class="flex items-center gap-2">
        <span class="h-2.5 w-2.5 rounded-full" :class="availability.available ? 'bg-success' : 'bg-text-secondary'" />
        <span class="font-medium">
          {{
            availability.available
              ? $t('agent.settings.workspaceRuntime.available')
              : $t('agent.settings.workspaceRuntime.unavailable')
          }}
        </span>
      </div>
      <p v-if="availability.reason" class="mt-2 text-xs text-text-secondary">{{ availability.reason }}</p>
    </div>

    <div v-if="error" class="mt-3 rounded border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
      {{ error }}
    </div>
    <div v-if="notice" class="mt-3 rounded border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
      {{ notice }}
    </div>

    <template v-if="availability.available && catalog && storage">
      <div class="mt-5 grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-border p-4">
          <h3 class="text-sm font-semibold">{{ $t('agent.settings.workspaceRuntime.setupTitle') }}</h3>
          <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.workspaceRuntime.setupDescription') }}</p>
          <div class="mt-3 space-y-2">
            <label
              v-for="recipe in catalog.recipes"
              :key="recipe.id"
              class="flex items-start gap-2 rounded bg-background p-2"
            >
              <input
                type="checkbox"
                class="mt-0.5"
                :checked="selectedRecipeIds.includes(recipe.id)"
                :disabled="disabled"
                @change="toggleRecipe(recipe.id)"
              />
              <span>
                <span class="block text-sm font-medium">{{ recipe.displayName }}</span>
                <span class="block text-xs text-text-secondary">{{ recipe.kind }}</span>
              </span>
            </label>
          </div>
          <button
            type="button"
            class="mt-3 rounded bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50"
            :disabled="disabled || !selectedRecipeIds.length"
            @click="previewSetup"
          >
            {{ $t('agent.settings.workspaceRuntime.previewSetup') }}
          </button>
          <div v-if="setupPreview" class="mt-3 rounded border border-border bg-background p-3 text-xs">
            <p>
              {{
                $t('agent.settings.workspaceRuntime.setupImpact', {
                  count: setupPreview.missingPacks.length,
                  bytes: formatBytes(setupPreview.installBytes),
                })
              }}
            </p>
            <button
              type="button"
              class="mt-2 rounded bg-primary px-3 py-1.5 text-white"
              :disabled="disabled"
              @click="confirmSetup"
            >
              {{ $t('agent.settings.workspaceRuntime.confirmSetup') }}
            </button>
          </div>
        </div>

        <div class="rounded-md border border-border p-4">
          <h3 class="text-sm font-semibold">{{ $t('agent.settings.workspaceRuntime.storageTitle') }}</h3>
          <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div class="rounded bg-background p-2">
              {{ $t('agent.settings.workspaceRuntime.stateBytes')
              }}<strong class="block">{{ formatBytes(storage.stateBytes) }}</strong>
            </div>
            <div class="rounded bg-background p-2">
              {{ $t('agent.settings.workspaceRuntime.packBytes')
              }}<strong class="block">{{ formatBytes(storage.packBytes) }}</strong>
            </div>
            <div class="rounded bg-background p-2">
              {{ $t('agent.settings.workspaceRuntime.cacheBytes')
              }}<strong class="block">{{ formatBytes(storage.cacheBytes) }}</strong>
            </div>
            <div class="rounded bg-background p-2">
              {{ $t('agent.settings.workspaceRuntime.runtimeBytes')
              }}<strong class="block">{{ formatBytes(storage.runtimeBytes) }}</strong>
            </div>
            <div class="rounded bg-background p-2">
              {{ $t('agent.settings.workspaceRuntime.quarantineBytes')
              }}<strong class="block">{{ formatBytes(storage.quarantineBytes) }}</strong>
            </div>
          </div>
          <p class="mt-2 text-xs text-text-secondary">
            {{ $t('agent.settings.workspaceRuntime.reclaimable', { bytes: formatBytes(storage.reclaimableBytes) }) }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded border border-border px-3 py-1.5 text-xs"
              :disabled="disabled"
              @click="previewRuntimeCleanup"
            >
              {{ $t('agent.settings.workspaceRuntime.previewCleanup') }}
            </button>
            <button
              type="button"
              class="rounded border border-border px-3 py-1.5 text-xs"
              :disabled="disabled"
              @click="cleanupCache"
            >
              {{ $t('agent.settings.workspaceRuntime.clearCache') }}
            </button>
            <button
              type="button"
              class="rounded border border-border px-3 py-1.5 text-xs"
              :disabled="disabled"
              @click="previewReset"
            >
              {{ $t('agent.settings.workspaceRuntime.previewReset') }}
            </button>
          </div>
          <div v-if="cleanupPreview" class="mt-3 rounded border border-border bg-background p-3 text-xs">
            <p>
              {{
                $t('agent.settings.workspaceRuntime.cleanupImpact', {
                  count: cleanupPreview.workspaceCount,
                  bytes: formatBytes(cleanupPreview.estimatedReclaimableBytes),
                  active: cleanupPreview.activeCount,
                  retained: cleanupPreview.retainedCount,
                })
              }}
            </p>
            <button
              type="button"
              class="mt-2 rounded bg-primary px-3 py-1.5 text-white"
              :disabled="disabled"
              @click="confirmRuntimeCleanup"
            >
              {{ $t('agent.settings.workspaceRuntime.confirmCleanup') }}
            </button>
          </div>
          <div v-if="resetPreview" class="mt-3 rounded border border-border bg-background p-3 text-xs">
            <p>{{ $t('agent.settings.workspaceRuntime.resetImpact') }}</p>
            <button
              type="button"
              class="mt-2 rounded bg-primary px-3 py-1.5 text-white"
              :disabled="disabled"
              @click="confirmReset"
            >
              {{ $t('agent.settings.workspaceRuntime.confirmReset') }}
            </button>
          </div>
        </div>
      </div>

      <div class="mt-5 rounded-md border border-border p-4">
        <div class="flex items-center justify-between gap-2">
          <div>
            <h3 class="text-sm font-semibold">{{ $t('agent.settings.workspaceRuntime.packsTitle') }}</h3>
            <p class="mt-1 text-xs text-text-secondary">
              {{ $t('agent.settings.workspaceRuntime.catalogRevision', { revision: catalog.revision }) }}
            </p>
          </div>
        </div>
        <div class="mt-3 space-y-2">
          <div
            v-for="pack in catalog.packs"
            :key="`${pack.familyId}:${pack.versionId}`"
            class="flex flex-wrap items-center justify-between gap-3 rounded bg-background p-3"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <strong>{{ pack.displayName }}</strong>
                <span class="text-xs text-text-secondary">{{ pack.familyId }}@{{ pack.versionId }}</span>
                <span v-if="pack.installed" class="rounded bg-success/15 px-1.5 py-0.5 text-xs text-success">{{
                  $t('agent.settings.workspaceRuntime.installed')
                }}</span>
                <span v-if="pack.inUse" class="rounded bg-primary/15 px-1.5 py-0.5 text-xs">{{
                  $t('agent.settings.workspaceRuntime.inUse')
                }}</span>
                <span v-if="isDesiredEnabled(pack)" class="rounded border border-border px-1.5 py-0.5 text-xs">{{
                  $t('agent.settings.workspaceRuntime.enabled')
                }}</span>
                <span v-if="isDesiredDefault(pack)" class="rounded border border-border px-1.5 py-0.5 text-xs">{{
                  $t('agent.settings.workspaceRuntime.defaultVersion')
                }}</span>
              </div>
              <p class="mt-1 text-xs text-text-secondary">{{ formatBytes(pack.diskBytes) }} · {{ pack.status }}</p>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-if="!pack.installed"
                type="button"
                class="rounded border border-border px-2 py-1 text-xs"
                :disabled="disabled || pack.status === 'unavailable'"
                @click="installPack(pack)"
              >
                {{ $t('agent.settings.workspaceRuntime.install') }}
              </button>
              <button
                type="button"
                class="rounded border border-border px-2 py-1 text-xs"
                :disabled="disabled || pack.status === 'unavailable'"
                @click="savePackPreference(pack, 'toggle')"
              >
                {{
                  isDesiredEnabled(pack)
                    ? $t('agent.settings.workspaceRuntime.disableVersion')
                    : $t('agent.settings.workspaceRuntime.enableVersion')
                }}
              </button>
              <button
                type="button"
                class="rounded border border-border px-2 py-1 text-xs"
                :disabled="disabled || isDesiredDefault(pack) || pack.status === 'unavailable'"
                @click="savePackPreference(pack, 'default')"
              >
                {{ $t('agent.settings.workspaceRuntime.makeDefault') }}
              </button>
              <button
                v-if="pack.installed"
                type="button"
                class="rounded border border-error/50 px-2 py-1 text-xs text-error"
                :disabled="disabled"
                @click="previewUninstall(pack)"
              >
                {{ $t('agent.settings.workspaceRuntime.uninstall') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="uninstallPreview" class="mt-4 rounded-md border border-error/40 bg-error/5 p-4 text-sm">
        <strong>{{
          $t('agent.settings.workspaceRuntime.uninstallTitle', { name: uninstallPreview.pack.displayName })
        }}</strong>
        <p class="mt-1 text-xs text-text-secondary">
          {{
            $t('agent.settings.workspaceRuntime.uninstallImpact', {
              bytes: formatBytes(uninstallPreview.pack.bytes),
              inUse: uninstallPreview.inUse
                ? $t('agent.settings.workspaceRuntime.yes')
                : $t('agent.settings.workspaceRuntime.no'),
              replacement: uninstallPreview.replacementDefaultVersionId || $t('agent.settings.workspaceRuntime.none'),
            })
          }}
        </p>
        <div class="mt-3 flex gap-2">
          <button
            type="button"
            class="rounded bg-error px-3 py-1.5 text-xs text-white disabled:opacity-50"
            :disabled="disabled || uninstallPreview.inUse"
            @click="confirmUninstall"
          >
            {{ $t('agent.settings.workspaceRuntime.confirmUninstall') }}
          </button>
          <button
            type="button"
            class="rounded border border-border px-3 py-1.5 text-xs"
            :disabled="disabled"
            @click="uninstallPreview = null"
          >
            {{ $t('agent.settings.workspaceRuntime.cancel') }}
          </button>
        </div>
      </div>

      <div v-if="lastCommand" class="mt-4 rounded-md bg-background p-3 text-xs text-text-secondary">
        {{
          $t('agent.settings.workspaceRuntime.commandStatus', {
            action: lastCommand.action,
            status: lastCommand.status,
          })
        }}
      </div>
    </template>
  </section>
</template>
