<script setup lang="ts">
  import { UiButton, UiCheckbox, UiInfoHint } from '@/foundation/ui';
  import { computed, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useOperationFeedback } from '@/shared/feedback/public';
  import {
    agentApi,
    formatAgentApiError,
    type AgentSettingsViewDto,
    type AgentWorkspaceRuntimeAvailabilityDto,
    type AgentWorkspaceRuntimeCatalogDto,
    type AgentToolchainCatalogPackDto,
    type AgentWorkspaceRuntimeCommandDto,
    type AgentToolchainPackUninstallPreviewDto,
    type AgentWorkspaceRuntimeCleanupPreviewDto,
    type AgentWorkspaceRuntimeSettingsResetPreviewDto,
    type AgentWorkspaceRuntimeSetupPreviewDto,
    type AgentWorkspaceRuntimeStorageDto,
  } from '../api/agent-api';

  const props = defineProps<{
    availability: AgentWorkspaceRuntimeAvailabilityDto;
    settings: AgentSettingsViewDto;
    busy: boolean;
  }>();
  const emit = defineEmits<{ settingsUpdated: [settings: AgentSettingsViewDto] }>();
  const { t } = useI18n();
  const operationFeedback = useOperationFeedback('agent.settings.workspace-runtime');

  /*
   * 后端 availability.reason 可能是约定码（runner_not_configured），也可能是上游
   * 直接抛出的英文错误消息。先把已知码翻译成人话；未知值退回通用说明，原始值
   * 只在 "原因代码" 行 + title 里出现，避免把机器码当唯一解释给用户看。
   */
  const availabilityReason = computed(() => {
    const code = props.availability.reason?.trim();
    if (!code) return null;
    const key = `agent.settings.workspaceRuntime.reason.${code}`;
    const translated = t(key);
    if (translated !== key) return { text: translated, code: '', raw: code };
    return { text: t('agent.settings.workspaceRuntime.reasonUnknown'), code, raw: code };
  });
  // 最近命令的 action / status 都是内部值，先查表再插进句子，未知值退回原值。
  const translateOrRaw = (prefix: string, value: string): string => {
    const key = `${prefix}.${value}`;
    const translated = t(key);
    return translated === key ? value : translated;
  };
  const lastCommandLabel = computed(() => {
    const command = lastCommand.value;
    if (!command) return '';
    return t('agent.settings.workspaceRuntime.commandStatus', {
      action: translateOrRaw('agent.settings.workspaceRuntime.commandAction', command.action),
      status: translateOrRaw('agent.settings.workspaceRuntime.commandState', command.status),
    });
  });

  const catalog = ref<AgentWorkspaceRuntimeCatalogDto | null>(null);
  const storage = ref<AgentWorkspaceRuntimeStorageDto | null>(null);
  const loading = ref(false);
  const localBusy = ref(false);
  const selectionBaseline = ref<string[]>([...props.settings.requestedSettings.workspaceRuntime.enabledRecipeIds]);
  const selectedRecipeIds = ref<string[]>([...selectionBaseline.value]);
  const setupPreview = ref<AgentWorkspaceRuntimeSetupPreviewDto | null>(null);
  const uninstallPreview = ref<AgentToolchainPackUninstallPreviewDto | null>(null);
  const cleanupPreview = ref<AgentWorkspaceRuntimeCleanupPreviewDto | null>(null);
  const resetPreview = ref<AgentWorkspaceRuntimeSettingsResetPreviewDto | null>(null);
  const lastCommand = ref<AgentWorkspaceRuntimeCommandDto | null>(null);
  let detailsGeneration = 0;

  const disabled = computed(() => props.busy || localBusy.value);
  const requested = computed(() => props.settings.requestedSettings.workspaceRuntime);
  const canonicalRecipeIds = (ids: readonly string[]): string => JSON.stringify([...ids].sort());
  const selectionDirty = computed(
    () => canonicalRecipeIds(selectedRecipeIds.value) !== canonicalRecipeIds(selectionBaseline.value),
  );
  const remoteMatchesSelection = computed(
    () => canonicalRecipeIds(selectedRecipeIds.value) === canonicalRecipeIds(requested.value.enabledRecipeIds),
  );

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

  const syncSelection = (): void => {
    selectionBaseline.value = [...requested.value.enabledRecipeIds];
    selectedRecipeIds.value = [...selectionBaseline.value];
  };

  const loadDetails = async () => {
    const generation = ++detailsGeneration;
    if (!props.availability.available) {
      catalog.value = null;
      storage.value = null;
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const [nextCatalog, nextStorage] = await Promise.all([
        agentApi.workspaceRuntimeCatalog(),
        agentApi.workspaceRuntimeStorage(),
      ]);
      if (generation !== detailsGeneration || !props.availability.available) return;
      catalog.value = nextCatalog;
      storage.value = nextStorage;
    } catch (cause) {
      if (generation !== detailsGeneration) return;
      operationFeedback.notifyError({ operation: 'load-details', message: errorMessage(cause), cause });
    } finally {
      if (generation === detailsGeneration) loading.value = false;
    }
  };

  const run = async (operation: string, action: () => Promise<void>) => {
    if (disabled.value) return;
    localBusy.value = true;
    try {
      await action();
    } catch (cause) {
      operationFeedback.notifyError({ operation, message: errorMessage(cause), cause });
    } finally {
      localBusy.value = false;
    }
  };

  const postCommitSync = async (operation: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (cause) {
      operationFeedback.notifyError({
        operation: `${operation}-resync`,
        message: t('agent.operations.postCommitSyncFailed'),
        cause,
      });
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
    run('preview-setup', async () => {
      if (!selectedRecipeIds.value.length) throw new Error(t('agent.settings.workspaceRuntime.selectRecipe'));
      setupPreview.value = await agentApi.previewWorkspaceRuntimeSetup(
        selectedRecipeIds.value.map((recipeId) => ({ recipeId })),
        props.settings.revision,
      );
    });

  const confirmSetup = () =>
    run('confirm-setup', async () => {
      if (!setupPreview.value) return;
      lastCommand.value = await agentApi.confirmWorkspaceRuntimeSetup(
        setupPreview.value.confirmationId,
        setupPreview.value.expectedVersion,
      );
      setupPreview.value = null;
      operationFeedback.notifySuccess(t('agent.settings.workspaceRuntime.setupSubmitted'));
      await postCommitSync('confirm-setup', async () => {
        emit('settingsUpdated', await agentApi.settings());
        await loadDetails();
      });
    });

  const familyConfig = (pack: AgentToolchainCatalogPackDto) =>
    requested.value.toolVersions[pack.familyId] ?? { enabledVersionIds: [], defaultVersionId: null };
  const isDesiredEnabled = (pack: AgentToolchainCatalogPackDto) =>
    familyConfig(pack).enabledVersionIds.includes(pack.versionId);
  const isDesiredDefault = (pack: AgentToolchainCatalogPackDto) =>
    familyConfig(pack).defaultVersionId === pack.versionId;

  const savePackPreference = (pack: AgentToolchainCatalogPackDto, mode: 'toggle' | 'default') =>
    run('save-pack-preference', async () => {
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
      operationFeedback.notifySuccess(t('agent.settings.workspaceRuntime.preferencesSaved'));
    });

  const installPack = (pack: AgentToolchainCatalogPackDto) =>
    run('install-pack', async () => {
      lastCommand.value = await agentApi.installToolchainPack(pack.familyId, pack.versionId);
      await loadDetails();
      operationFeedback.notifySuccess(t('agent.settings.workspaceRuntime.installSubmitted'));
    });

  const previewUninstall = (pack: AgentToolchainCatalogPackDto) =>
    run('preview-uninstall', async () => {
      uninstallPreview.value = await agentApi.previewToolchainPackUninstall(
        pack.familyId,
        pack.versionId,
        props.settings.revision,
      );
    });

  const confirmUninstall = () =>
    run('confirm-uninstall', async () => {
      const preview = uninstallPreview.value;
      if (!preview) return;
      lastCommand.value = await agentApi.confirmToolchainPackUninstall(
        preview.pack.familyId,
        preview.pack.versionId,
        preview.confirmationId,
        preview.expectedVersion,
      );
      uninstallPreview.value = null;
      operationFeedback.notifySuccess(t('agent.settings.workspaceRuntime.uninstallSubmitted'));
      await postCommitSync('confirm-uninstall', async () => {
        emit('settingsUpdated', await agentApi.settings());
        await loadDetails();
      });
    });

  const previewRuntimeCleanup = () =>
    run('preview-cleanup', async () => {
      cleanupPreview.value = await agentApi.previewWorkspaceRuntimeCleanup(props.settings.revision);
    });

  const confirmRuntimeCleanup = () =>
    run('confirm-cleanup', async () => {
      if (!cleanupPreview.value) return;
      lastCommand.value = await agentApi.confirmWorkspaceRuntimeCleanup(
        cleanupPreview.value.confirmationId,
        cleanupPreview.value.expectedVersion,
      );
      cleanupPreview.value = null;
      await loadDetails();
      operationFeedback.notifySuccess(t('agent.settings.workspaceRuntime.cleanupSubmitted'));
    });

  const cleanupCache = () =>
    run('cleanup-cache', async () => {
      lastCommand.value = await agentApi.cleanupWorkspaceRuntimeCache();
      await loadDetails();
      operationFeedback.notifySuccess(t('agent.settings.workspaceRuntime.cacheSubmitted'));
    });

  const previewReset = () =>
    run('preview-reset', async () => {
      resetPreview.value = await agentApi.previewWorkspaceRuntimeSettingsReset(props.settings.revision);
    });

  const confirmReset = () =>
    run('confirm-reset', async () => {
      if (!resetPreview.value) return;
      await agentApi.confirmWorkspaceRuntimeSettingsReset(
        resetPreview.value.confirmationId,
        resetPreview.value.expectedVersion,
      );
      resetPreview.value = null;
      operationFeedback.notifySuccess(t('agent.settings.workspaceRuntime.resetComplete'));
      await postCommitSync('confirm-reset', async () => {
        emit('settingsUpdated', await agentApi.settings());
        syncSelection();
      });
    });

  watch(
    () => props.settings.revision,
    () => {
      if (!selectionDirty.value || remoteMatchesSelection.value) syncSelection();
    },
  );
  watch(() => props.availability.available, loadDetails);
  onMounted(() => {
    syncSelection();
    void loadDetails();
  });
</script>

<template>
  <section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
    <div
      class="flex flex-wrap items-center justify-between gap-3 bg-header/50 px-4 py-3 sm:px-5 sm:py-3.5 agent-settings-head"
      :class="{
        'border-b border-border': availability.available && ((catalog && storage) || loading),
      }"
    >
      <div class="flex items-center gap-1.5">
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.workspaceRuntime.title') }}</h3>
        <UiInfoHint :text="$t('agent.settings.workspaceRuntime.description')" />
      </div>
      <div class="flex items-center gap-2.5">
        <span
          class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all"
          :class="
            availability.available
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-border/70 bg-background/80 text-text-secondary'
          "
          :title="
            availability.available
              ? undefined
              : availabilityReason?.text || $t('agent.settings.workspaceRuntime.reasonUnknown')
          "
        >
          <span
            class="h-1.5 w-1.5 rounded-full"
            :class="availability.available ? 'bg-success' : 'bg-text-secondary/70'"
          ></span>
          <span>{{
            availability.available
              ? $t('agent.settings.workspaceRuntime.available')
              : $t('agent.settings.workspaceRuntime.unavailable')
          }}</span>
        </span>
        <UiButton
          appearance="soft"
          tone="neutral"
          type="button"
          :disabled="disabled || loading"
          @click="refreshObserved"
        >
          <i class="fa-solid fa-arrows-rotate text-xs" :class="{ 'fa-spin': loading }" aria-hidden="true"></i>
          <span>{{ $t('agent.settings.workspaceRuntime.refresh') }}</span>
        </UiButton>
      </div>
    </div>

    <!-- 加载中指示 -->
    <div
      v-if="availability.available && (!catalog || !storage) && loading"
      class="p-6 text-center text-xs text-text-secondary"
    >
      <i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-primary"></i>
      <span>{{ $t('agent.settings.loading') }}</span>
    </div>

    <!-- 运行环境已就绪卡片主体 -->
    <div v-else-if="availability.available && catalog && storage" class="space-y-4 p-4 sm:p-5">
      <div class="grid gap-4 lg:grid-cols-2">
        <!-- 初始化与 Profile -->
        <div class="rounded-xl border border-border bg-background/60 p-4 sm:p-5 shadow-2xs">
          <div class="flex items-center gap-2">
            <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <i class="fa-solid fa-shapes text-xs" aria-hidden="true"></i>
            </div>
            <h4 class="text-sm font-semibold text-foreground">
              {{ $t('agent.settings.workspaceRuntime.setupTitle') }}
            </h4>
          </div>
          <p class="mt-1.5 text-xs leading-relaxed text-text-secondary">
            {{ $t('agent.settings.workspaceRuntime.setupDescription') }}
          </p>
          <div class="mt-3.5 space-y-2">
            <label
              v-for="recipe in catalog.recipes"
              :key="recipe.id"
              class="flex items-start gap-3 rounded-lg border border-border/70 bg-card/70 p-3 transition-all hover:border-primary/40 hover:bg-card cursor-pointer"
            >
              <UiCheckbox
                class="mt-0.5"
                :model-value="selectedRecipeIds.includes(recipe.id)"
                :disabled="disabled"
                @update:model-value="toggleRecipe(recipe.id)"
              />
              <span class="min-w-0 flex-1">
                <span class="block text-xs font-semibold text-foreground">{{ recipe.displayName }}</span>
                <span class="mt-0.5 block text-[11px] text-text-secondary">{{ recipe.kind }}</span>
              </span>
            </label>
          </div>
          <UiButton
            appearance="solid"
            tone="primary"
            type="button"
            :disabled="disabled || !selectedRecipeIds.length"
            @click="previewSetup"
            class="mt-3.5"
          >
            {{ $t('agent.settings.workspaceRuntime.previewSetup') }}
          </UiButton>
          <div v-if="setupPreview" class="mt-3.5 rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-xs">
            <p class="leading-relaxed">
              {{
                $t('agent.settings.workspaceRuntime.setupImpact', {
                  count: setupPreview.missingPacks.length,
                  bytes: formatBytes(setupPreview.installBytes),
                })
              }}
            </p>
            <UiButton
              appearance="solid"
              tone="primary"
              type="button"
              :disabled="disabled"
              @click="confirmSetup"
              class="mt-2.5"
            >
              {{ $t('agent.settings.workspaceRuntime.confirmSetup') }}
            </UiButton>
          </div>
        </div>

        <!-- Runner 存储 -->
        <div class="rounded-xl border border-border bg-background/60 p-4 sm:p-5 shadow-2xs">
          <div class="flex items-center gap-2">
            <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <i class="fa-solid fa-hard-drive text-xs" aria-hidden="true"></i>
            </div>
            <h4 class="text-sm font-semibold text-foreground">
              {{ $t('agent.settings.workspaceRuntime.storageTitle') }}
            </h4>
          </div>

          <div class="mt-3.5 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div class="rounded-lg border border-border/80 bg-card p-2.5 shadow-2xs">
              <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.workspaceRuntime.stateBytes') }}</div>
              <div class="mt-1 font-mono text-xs font-semibold text-foreground">
                {{ formatBytes(storage.stateBytes) }}
              </div>
            </div>
            <div class="rounded-lg border border-border/80 bg-card p-2.5 shadow-2xs">
              <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.workspaceRuntime.packBytes') }}</div>
              <div class="mt-1 font-mono text-xs font-semibold text-foreground">
                {{ formatBytes(storage.packBytes) }}
              </div>
            </div>
            <div class="rounded-lg border border-border/80 bg-card p-2.5 shadow-2xs">
              <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.workspaceRuntime.cacheBytes') }}</div>
              <div class="mt-1 font-mono text-xs font-semibold text-foreground">
                {{ formatBytes(storage.cacheBytes) }}
              </div>
            </div>
            <div class="rounded-lg border border-border/80 bg-card p-2.5 shadow-2xs">
              <div class="text-[11px] text-text-secondary">
                {{ $t('agent.settings.workspaceRuntime.runtimeBytes') }}
              </div>
              <div class="mt-1 font-mono text-xs font-semibold text-foreground">
                {{ formatBytes(storage.runtimeBytes) }}
              </div>
            </div>
            <div class="rounded-lg border border-border/80 bg-card p-2.5 shadow-2xs col-span-2 sm:col-span-1">
              <div class="text-[11px] text-text-secondary">
                {{ $t('agent.settings.workspaceRuntime.quarantineBytes') }}
              </div>
              <div class="mt-1 font-mono text-xs font-semibold text-foreground">
                {{ formatBytes(storage.quarantineBytes) }}
              </div>
            </div>
          </div>

          <div
            class="mt-3 flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs text-success"
          >
            <i class="fa-solid fa-recycle text-[11px]" aria-hidden="true"></i>
            <span>{{
              $t('agent.settings.workspaceRuntime.reclaimable', { bytes: formatBytes(storage.reclaimableBytes) })
            }}</span>
          </div>

          <div class="mt-3.5 flex flex-wrap gap-2">
            <UiButton
              appearance="soft"
              tone="neutral"
              type="button"
              :disabled="disabled"
              @click="previewRuntimeCleanup"
            >
              {{ $t('agent.settings.workspaceRuntime.previewCleanup') }}
            </UiButton>
            <UiButton appearance="soft" tone="neutral" type="button" :disabled="disabled" @click="cleanupCache">
              {{ $t('agent.settings.workspaceRuntime.clearCache') }}
            </UiButton>
            <UiButton appearance="soft" tone="neutral" type="button" :disabled="disabled" @click="previewReset">
              {{ $t('agent.settings.workspaceRuntime.previewReset') }}
            </UiButton>
          </div>

          <div v-if="cleanupPreview" class="mt-3.5 rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-xs">
            <p class="leading-relaxed">
              {{
                $t('agent.settings.workspaceRuntime.cleanupImpact', {
                  count: cleanupPreview.workspaceCount,
                  bytes: formatBytes(cleanupPreview.estimatedReclaimableBytes),
                  active: cleanupPreview.activeCount,
                  retained: cleanupPreview.retainedCount,
                })
              }}
            </p>
            <UiButton
              appearance="solid"
              tone="primary"
              type="button"
              :disabled="disabled"
              @click="confirmRuntimeCleanup"
              class="mt-2.5"
            >
              {{ $t('agent.settings.workspaceRuntime.confirmCleanup') }}
            </UiButton>
          </div>
          <div v-if="resetPreview" class="mt-3.5 rounded-xl border border-warning/30 bg-warning/5 p-3.5 text-xs">
            <p class="leading-relaxed">{{ $t('agent.settings.workspaceRuntime.resetImpact') }}</p>
            <UiButton
              appearance="solid"
              tone="primary"
              type="button"
              :disabled="disabled"
              @click="confirmReset"
              class="mt-2.5"
            >
              {{ $t('agent.settings.workspaceRuntime.confirmReset') }}
            </UiButton>
          </div>
        </div>
      </div>

      <!-- 工具包 -->
      <div class="rounded-xl border border-border bg-background/60 p-4 sm:p-5 shadow-2xs">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <i class="fa-solid fa-boxes-stacked text-xs" aria-hidden="true"></i>
            </div>
            <div>
              <h4 class="text-sm font-semibold text-foreground">
                {{ $t('agent.settings.workspaceRuntime.packsTitle') }}
              </h4>
              <p class="text-[11px] text-text-secondary">
                {{ $t('agent.settings.workspaceRuntime.catalogRevision', { revision: catalog.revision }) }}
              </p>
            </div>
          </div>
        </div>
        <div class="mt-3.5 space-y-2.5">
          <div
            v-for="pack in catalog.packs"
            :key="`${pack.familyId}:${pack.versionId}`"
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/70 p-3.5 shadow-2xs transition-all hover:border-border/90"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="font-semibold text-foreground">{{ pack.displayName }}</span>
                <span
                  class="rounded-md border border-border/60 bg-header/40 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary"
                >
                  {{ pack.familyId }}@{{ pack.versionId }}
                </span>
                <span
                  v-if="pack.installed"
                  class="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success"
                  >{{ $t('agent.settings.workspaceRuntime.installed') }}</span
                >
                <span
                  v-if="pack.inUse"
                  class="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary"
                  >{{ $t('agent.settings.workspaceRuntime.inUse') }}</span
                >
                <span
                  v-if="isDesiredEnabled(pack)"
                  class="rounded-full border border-border/80 bg-background/80 px-2 py-0.5 text-[11px] text-text-secondary"
                  >{{ $t('agent.settings.workspaceRuntime.enabled') }}</span
                >
                <span
                  v-if="isDesiredDefault(pack)"
                  class="rounded-full border border-border/80 bg-background/80 px-2 py-0.5 text-[11px] text-text-secondary"
                  >{{ $t('agent.settings.workspaceRuntime.defaultVersion') }}</span
                >
              </div>
              <p class="mt-1 text-[11px] text-text-secondary font-mono">
                {{ formatBytes(pack.diskBytes) }} · <span class="capitalize">{{ pack.status }}</span>
              </p>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <UiButton
                appearance="soft"
                tone="neutral"
                v-if="!pack.installed"
                type="button"
                :disabled="disabled || pack.status === 'unavailable'"
                @click="installPack(pack)"
              >
                {{ $t('agent.settings.workspaceRuntime.install') }}
              </UiButton>
              <UiButton
                appearance="soft"
                tone="neutral"
                type="button"
                :disabled="disabled || pack.status === 'unavailable'"
                @click="savePackPreference(pack, 'toggle')"
              >
                {{
                  isDesiredEnabled(pack)
                    ? $t('agent.settings.workspaceRuntime.disableVersion')
                    : $t('agent.settings.workspaceRuntime.enableVersion')
                }}
              </UiButton>
              <UiButton
                appearance="soft"
                tone="neutral"
                type="button"
                :disabled="disabled || isDesiredDefault(pack) || pack.status === 'unavailable'"
                @click="savePackPreference(pack, 'default')"
              >
                {{ $t('agent.settings.workspaceRuntime.makeDefault') }}
              </UiButton>
              <UiButton
                appearance="soft"
                tone="danger"
                v-if="pack.installed"
                type="button"
                :disabled="disabled"
                @click="previewUninstall(pack)"
              >
                {{ $t('agent.settings.workspaceRuntime.uninstall') }}
              </UiButton>
            </div>
          </div>
        </div>
      </div>

      <!-- 卸载确认卡片 -->
      <div v-if="uninstallPreview" class="rounded-xl border border-error/40 bg-error/5 p-4 text-xs">
        <div class="flex items-center gap-2 font-semibold text-error text-sm">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <span>{{
            $t('agent.settings.workspaceRuntime.uninstallTitle', { name: uninstallPreview.pack.displayName })
          }}</span>
        </div>
        <p class="mt-1.5 text-xs text-text-secondary leading-relaxed">
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
        <div class="mt-3.5 flex gap-2">
          <UiButton
            appearance="solid"
            tone="danger"
            type="button"
            :disabled="disabled || uninstallPreview.inUse"
            @click="confirmUninstall"
          >
            {{ $t('agent.settings.workspaceRuntime.confirmUninstall') }}
          </UiButton>
          <UiButton
            appearance="soft"
            tone="neutral"
            type="button"
            :disabled="disabled"
            @click="uninstallPreview = null"
          >
            {{ $t('agent.settings.workspaceRuntime.cancel') }}
          </UiButton>
        </div>
      </div>

      <!-- 最近命令 -->
      <div
        v-if="lastCommand"
        class="flex items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-3.5 py-2.5 text-xs text-text-secondary"
      >
        <i class="fa-solid fa-clock-rotate-left text-[11px] text-text-secondary/70" aria-hidden="true"></i>
        <span>{{ lastCommandLabel }}</span>
      </div>
    </div>
  </section>
</template>
