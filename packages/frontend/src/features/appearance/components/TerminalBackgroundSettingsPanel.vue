<script setup lang="ts">
  import { computed, onMounted, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    UiBadge,
    UiButton,
    UiCheckbox,
    UiFormField,
    UiInput,
    UiModal,
    UiSelect,
    UiSlider,
    UiSpinner,
    UiSurface,
    UiSwitch,
    UiTextarea,
  } from '@/foundation/ui';
  import AppearancePresetToolbar from './AppearancePresetToolbar.vue';
  import { useFeedback } from '@/shared/feedback/public';
  import { appearanceApi } from '../api/appearanceApi';
  import type { LocalHtmlThemeDto, RemoteHtmlThemeDto } from '@nexus-terminal/protocol/appearance';
  import { useAppearanceStore } from '../store/appearance.store';

  type BackgroundSection = 'all' | 'background' | 'text-effects';
  const props = withDefaults(defineProps<{ section?: BackgroundSection }>(), { section: 'all' });

  const showPageBackground = computed(() => props.section === 'all');
  const showBackground = computed(() => props.section === 'all' || props.section === 'background');
  const showTextEffects = computed(() => props.section === 'all' || props.section === 'text-effects');

  const { t } = useI18n();
  const feedback = useFeedback();
  const store = useAppearanceStore();
  const localThemes = ref<LocalHtmlThemeDto[]>([]);
  const remoteThemes = ref<RemoteHtmlThemeDto[]>([]);
  const loadingLocal = ref(false);
  const loadingRemote = ref(false);
  const remoteRepositoryUrl = ref('');
  const presetEditorVisible = ref(false);
  const editingLocalName = ref<string | null>(null);
  const presetName = ref('');
  const presetContent = ref('');
  const localSearch = ref('');
  const remoteSearch = ref('');
  const htmlThemeTab = ref<'local' | 'remote'>('local');
  const pageBackgroundInput = ref<HTMLInputElement | null>(null);
  const terminalBackgroundInput = ref<HTMLInputElement | null>(null);

  const form = reactive({
    terminalBackgroundEnabled: true,
    terminalBackgroundOverlayOpacity: 0.5,
    terminalCustomHtml: '',
    terminalTextStrokeEnabled: false,
    terminalTextStrokeWidth: 1,
    terminalTextStrokeColor: '#000000',
    terminalTextShadowEnabled: false,
    terminalTextShadowOffsetX: 0,
    terminalTextShadowOffsetY: 0,
    terminalTextShadowBlur: 0,
    terminalTextShadowColor: 'rgba(0,0,0,0.5)',
  });

  const sync = (): void => {
    Object.assign(form, {
      terminalBackgroundEnabled: store.settings.terminalBackgroundEnabled ?? true,
      terminalBackgroundOverlayOpacity: store.settings.terminalBackgroundOverlayOpacity ?? 0.5,
      terminalCustomHtml: store.settings.terminalCustomHtml ?? '',
      terminalTextStrokeEnabled: store.settings.terminalTextStrokeEnabled ?? false,
      terminalTextStrokeWidth: store.settings.terminalTextStrokeWidth ?? 1,
      terminalTextStrokeColor: store.settings.terminalTextStrokeColor ?? '#000000',
      terminalTextShadowEnabled: store.settings.terminalTextShadowEnabled ?? false,
      terminalTextShadowOffsetX: store.settings.terminalTextShadowOffsetX ?? 0,
      terminalTextShadowOffsetY: store.settings.terminalTextShadowOffsetY ?? 0,
      terminalTextShadowBlur: store.settings.terminalTextShadowBlur ?? 0,
      terminalTextShadowColor: store.settings.terminalTextShadowColor ?? 'rgba(0,0,0,0.5)',
    });
    remoteRepositoryUrl.value = store.settings.remoteHtmlPresetsUrl ?? remoteRepositoryUrl.value;
  };

  watch(
    () => store.settings.terminalBackgroundEnabled,
    (value) => {
      form.terminalBackgroundEnabled = value ?? true;
    },
  );
  watch(
    () => store.settings.terminalBackgroundOverlayOpacity,
    (value) => {
      form.terminalBackgroundOverlayOpacity = value ?? 0.5;
    },
  );
  watch(
    () => store.settings.terminalCustomHtml,
    (value) => {
      form.terminalCustomHtml = value ?? '';
    },
  );
  watch(
    () => store.settings.terminalTextStrokeEnabled,
    (value) => {
      form.terminalTextStrokeEnabled = value ?? false;
    },
  );
  watch(
    () => store.settings.terminalTextStrokeWidth,
    (value) => {
      form.terminalTextStrokeWidth = value ?? 1;
    },
  );
  watch(
    () => store.settings.terminalTextStrokeColor,
    (value) => {
      form.terminalTextStrokeColor = value ?? '#000000';
    },
  );
  watch(
    () => store.settings.terminalTextShadowEnabled,
    (value) => {
      form.terminalTextShadowEnabled = value ?? false;
    },
  );
  watch(
    () => store.settings.terminalTextShadowOffsetX,
    (value) => {
      form.terminalTextShadowOffsetX = value ?? 0;
    },
  );
  watch(
    () => store.settings.terminalTextShadowOffsetY,
    (value) => {
      form.terminalTextShadowOffsetY = value ?? 0;
    },
  );
  watch(
    () => store.settings.terminalTextShadowBlur,
    (value) => {
      form.terminalTextShadowBlur = value ?? 0;
    },
  );
  watch(
    () => store.settings.terminalTextShadowColor,
    (value) => {
      form.terminalTextShadowColor = value ?? 'rgba(0,0,0,0.5)';
    },
  );
  watch(
    () => store.settings.remoteHtmlPresetsUrl,
    (value) => {
      remoteRepositoryUrl.value = value ?? '';
    },
  );

  const filteredLocalThemes = computed(() => {
    const query = localSearch.value.trim().toLowerCase();
    const themes = query
      ? localThemes.value.filter((theme) => theme.name.toLowerCase().includes(query))
      : localThemes.value;
    return [...themes].sort((left, right) => left.name.localeCompare(right.name));
  });

  const filteredRemoteThemes = computed(() => {
    const query = remoteSearch.value.trim().toLowerCase();
    const themes = query
      ? remoteThemes.value.filter((theme) => theme.name.toLowerCase().includes(query))
      : remoteThemes.value;
    return [...themes].sort((left, right) => left.name.localeCompare(right.name));
  });

  const loadLocalThemes = async (): Promise<void> => {
    loadingLocal.value = true;
    try {
      localThemes.value = await appearanceApi.listLocalHtmlThemes();
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.localPresetApplyFailed', { message: String(cause) }));
    } finally {
      loadingLocal.value = false;
    }
  };

  const loadRemoteThemes = async (): Promise<void> => {
    if (!remoteRepositoryUrl.value.trim()) {
      remoteThemes.value = [];
      feedback.notifyWarning(t('styleCustomizer.errorSetRemoteUrlFirst'));
      return;
    }
    loadingRemote.value = true;
    try {
      remoteThemes.value = await appearanceApi.listRemoteHtmlThemes(remoteRepositoryUrl.value.trim());
      feedback.notifySuccess(t('styleCustomizer.remotePresetsLoaded'));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.remotePresetsLoadFailed', { message: String(cause) }));
    } finally {
      loadingRemote.value = false;
    }
  };

  onMounted(async () => {
    sync();
    if (!showBackground.value) return;
    await loadLocalThemes();
    try {
      remoteRepositoryUrl.value = (await appearanceApi.getRemoteHtmlRepositoryUrl()) ?? '';
      if (remoteRepositoryUrl.value) await loadRemoteThemes();
    } catch {
      remoteRepositoryUrl.value = store.settings.remoteHtmlPresetsUrl ?? '';
    }
  });

  const saveVisuals = async (): Promise<void> => {
    try {
      await store.update({ ...form });
      feedback.notifySuccess(t('common.saved'));
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : t('common.errorOccurred'));
    }
  };

  const uploadBackground = async (kind: 'page' | 'terminal', event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const filePath = await appearanceApi.uploadBackground(kind, file);
      store.applyBackgroundReference(kind, filePath);
      feedback.notifySuccess(
        t(kind === 'page' ? 'styleCustomizer.pageBgUploadSuccess' : 'styleCustomizer.terminalBgUploadSuccess'),
      );
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.uploadFailed', { message: String(cause) }));
    } finally {
      input.value = '';
    }
  };

  const removeBackground = async (kind: 'page' | 'terminal'): Promise<void> => {
    try {
      await appearanceApi.removeBackground(kind);
      store.applyBackgroundReference(kind, '');
      feedback.notifySuccess(
        t(kind === 'page' ? 'styleCustomizer.pageBgRemoved' : 'styleCustomizer.terminalBgRemoved'),
      );
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.removeBgFailed', { message: String(cause) }));
    }
  };

  const openNewPreset = (): void => {
    editingLocalName.value = null;
    presetName.value = '';
    presetContent.value = form.terminalCustomHtml;
    presetEditorVisible.value = true;
  };

  const openLocalPreset = async (theme: LocalHtmlThemeDto): Promise<void> => {
    try {
      const content = await appearanceApi.readLocalHtmlTheme(theme.name);
      editingLocalName.value = theme.type === 'custom' ? theme.name : null;
      presetName.value = theme.type === 'custom' ? theme.name : `${theme.name.replace(/\.html$/i, '')}-copy.html`;
      presetContent.value = content;
      presetEditorVisible.value = true;
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.errorFetchingPresetContentForEdit', { message: String(cause) }));
    }
  };

  const normalizedPresetName = (): string => {
    const name = presetName.value.trim();
    return name.toLowerCase().endsWith('.html') ? name : `${name}.html`;
  };

  const saveLocalPreset = async (): Promise<void> => {
    if (!presetName.value.trim() || !presetContent.value.trim()) {
      feedback.notifyWarning(t('styleCustomizer.errorPresetNameAndContentRequired'));
      return;
    }

    const nextName = normalizedPresetName();
    try {
      if (editingLocalName.value === nextName) {
        await appearanceApi.updateLocalHtmlTheme(nextName, presetContent.value);
        feedback.notifySuccess(t('styleCustomizer.localPresetUpdated'));
      } else {
        await appearanceApi.createLocalHtmlTheme(nextName, presetContent.value);
        if (editingLocalName.value) await appearanceApi.deleteLocalHtmlTheme(editingLocalName.value);
        feedback.notifySuccess(t('styleCustomizer.localPresetCreated'));
      }
      presetEditorVisible.value = false;
      await loadLocalThemes();
    } catch (cause) {
      const key = editingLocalName.value
        ? 'styleCustomizer.localPresetUpdateFailed'
        : 'styleCustomizer.localPresetCreateFailed';
      feedback.notifyError(t(key, { message: String(cause) }));
    }
  };

  const applyLocalPreset = async (theme: LocalHtmlThemeDto): Promise<void> => {
    try {
      const content = await appearanceApi.readLocalHtmlTheme(theme.name);
      await store.update({ terminalCustomHtml: content, terminalBackgroundEnabled: true });
      feedback.notifySuccess(t('styleCustomizer.htmlPresetApplied'));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.localPresetApplyFailed', { message: String(cause) }));
    }
  };

  const deleteLocalPreset = async (theme: LocalHtmlThemeDto): Promise<void> => {
    if (theme.type !== 'custom') return;
    if (
      !(await feedback.confirm({
        message: t('styleCustomizer.confirmDeletePreset', { name: theme.name }),
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await appearanceApi.deleteLocalHtmlTheme(theme.name);
      await loadLocalThemes();
      feedback.notifySuccess(t('styleCustomizer.localPresetDeleted'));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.localPresetDeleteFailed', { message: String(cause) }));
    }
  };

  const saveRemoteRepository = async (): Promise<void> => {
    try {
      const value = remoteRepositoryUrl.value.trim() || null;
      await appearanceApi.setRemoteHtmlRepositoryUrl(value);
      await store.load(true);
      if (!value) remoteThemes.value = [];
      feedback.notifySuccess(t('styleCustomizer.remoteUrlSaved'));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.remoteUrlSaveFailed', { message: String(cause) }));
    }
  };

  const applyRemotePreset = async (theme: RemoteHtmlThemeDto): Promise<void> => {
    if (!theme.downloadUrl) {
      feedback.notifyWarning(t('styleCustomizer.errorMissingDownloadUrl'));
      return;
    }
    try {
      const content = await appearanceApi.readRemoteHtmlTheme(theme.downloadUrl);
      await store.update({ terminalCustomHtml: content, terminalBackgroundEnabled: true });
      feedback.notifySuccess(t('styleCustomizer.htmlPresetApplied'));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.remotePresetApplyFailed', { message: String(cause) }));
    }
  };

  const toggleTerminalBackground = async (enabled: boolean): Promise<void> => {
    form.terminalBackgroundEnabled = enabled;
    try {
      await store.update({ terminalBackgroundEnabled: enabled });
    } catch (cause) {
      form.terminalBackgroundEnabled = !enabled;
      feedback.notifyError(t('styleCustomizer.errorToggleTerminalBg', { message: String(cause) }));
    }
  };

  const saveBackgroundOverlayOpacity = async (): Promise<void> => {
    try {
      await store.update({ terminalBackgroundOverlayOpacity: form.terminalBackgroundOverlayOpacity });
      feedback.notifySuccess(t('styleCustomizer.terminalBgOverlayOpacitySaved'));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.terminalBgOverlayOpacitySaveFailed', { message: String(cause) }));
    }
  };

  const clearCustomHtml = async (): Promise<void> => {
    try {
      await store.update({ terminalCustomHtml: null });
      feedback.notifySuccess(t('styleCustomizer.customHtmlResetSuccess'));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.htmlPresetApplyFailed', { message: String(cause) }));
    }
  };
</script>

<template>
  <section class="min-w-0 space-y-4">
    <template v-if="props.section === 'background'">
      <h3 class="mb-4 mt-0 border-b border-border pb-2 text-lg font-semibold text-foreground">
        {{ t('styleCustomizer.backgroundSettings') }}
      </h3>

      <UiSurface surface="inset" class="space-y-3 p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="min-w-0">
            <h4 class="m-0 text-base font-semibold text-foreground">{{ t('styleCustomizer.pageBackground') }}</h4>
            <p class="mt-1 break-all text-xs text-text-secondary">
              {{ store.settings.pageBackgroundImage || t('styleCustomizer.noBackground') }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UiButton density="compact" @click="pageBackgroundInput?.click()">
              {{ t('styleCustomizer.uploadPageBg') }}
            </UiButton>
            <UiButton
              v-if="store.settings.pageBackgroundImage"
              density="compact"
              appearance="solid"
              tone="danger"
              @click="removeBackground('page')"
            >
              {{ t('styleCustomizer.removePageBg') }}
            </UiButton>
          </div>
        </div>
        <input
          ref="pageBackgroundInput"
          type="file"
          accept="image/*"
          class="hidden"
          @change="uploadBackground('page', $event)"
        />
      </UiSurface>

      <hr class="my-4 border-border md:my-8" />

      <div class="mb-3 flex items-center justify-between">
        <h4 class="m-0 text-base font-semibold text-foreground">{{ t('styleCustomizer.terminalBackground') }}</h4>
        <UiSwitch
          :model-value="form.terminalBackgroundEnabled"
          :aria-label="t('styleCustomizer.terminalBackground')"
          @update:model-value="toggleTerminalBackground"
        />
      </div>

      <template v-if="form.terminalBackgroundEnabled">
        <div
          class="relative mb-2 flex h-[100px] w-full items-center justify-center overflow-hidden rounded border border-dashed border-border bg-header bg-cover bg-center bg-no-repeat text-text-secondary md:h-[150px]"
          :style="{
            backgroundImage: store.settings.terminalBackgroundImage
              ? `url(${store.settings.terminalBackgroundImage})`
              : 'none',
          }"
        >
          <div
            v-if="store.settings.terminalBackgroundImage"
            class="absolute inset-0"
            :style="{ backgroundColor: `rgb(0 0 0 / ${form.terminalBackgroundOverlayOpacity})` }"
          ></div>
          <span
            v-else
            class="relative z-10 rounded bg-[var(--app-bg-color)]/80 px-3 py-1.5 text-sm font-medium text-foreground shadow-sm"
          >
            {{ t('styleCustomizer.noBackground') }}
          </span>
        </div>
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <UiButton density="compact" @click="terminalBackgroundInput?.click()">{{
            t('styleCustomizer.uploadTerminalBg')
          }}</UiButton>
          <UiButton
            density="compact"
            appearance="solid"
            tone="danger"
            :disabled="!store.settings.terminalBackgroundImage"
            @click="removeBackground('terminal')"
          >
            {{ t('styleCustomizer.removeTerminalBg') }}
          </UiButton>
          <input
            ref="terminalBackgroundInput"
            type="file"
            accept="image/*"
            class="hidden"
            @change="uploadBackground('terminal', $event)"
          />
        </div>

        <div class="mt-4 border-t border-border/50 pt-4">
          <label class="mb-1 block text-sm font-medium text-foreground">{{
            t('styleCustomizer.terminalBgOverlayOpacity')
          }}</label>
          <div class="flex items-center gap-3">
            <UiSlider
              v-model="form.terminalBackgroundOverlayOpacity"
              :min="0"
              :max="1"
              :step="0.01"
              :aria-label="t('styleCustomizer.terminalBgOverlayOpacity')"
            />
            <span class="min-w-[3em] text-right text-sm text-foreground">{{
              form.terminalBackgroundOverlayOpacity.toFixed(2)
            }}</span>
            <UiButton density="compact" @click="saveBackgroundOverlayOpacity">{{ t('common.save') }}</UiButton>
          </div>
        </div>

        <hr class="my-6 border-border" />
        <div class="mb-3 flex items-center gap-2">
          <h4 class="m-0 text-base font-semibold text-foreground">{{ t('styleCustomizer.htmlBackgroundThemes') }}</h4>
          <UiButton
            density="compact"
            appearance="ghost"
            icon-only
            :title="t('common.restore')"
            :aria-label="t('common.restore')"
            @click="clearCustomHtml"
          >
            <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
          </UiButton>
        </div>

        <UiFormField :label="t('styleCustomizer.htmlBackgroundThemes')" class="mb-4">
          <UiSelect
            v-model="htmlThemeTab"
            :aria-label="t('styleCustomizer.htmlBackgroundThemes')"
            :options="[
              { value: 'local', label: t('styleCustomizer.localThemes') },
              { value: 'remote', label: t('styleCustomizer.remoteThemes') },
            ]"
            match-trigger-width
          />
        </UiFormField>

        <div v-if="htmlThemeTab === 'local'">
          <AppearancePresetToolbar
            v-model="localSearch"
            class="mb-4"
            :placeholder="t('styleCustomizer.searchLocalThemesPlaceholder')"
          >
            <UiButton density="compact" class="shrink-0" @click="openNewPreset">{{
              t('styleCustomizer.addNewTheme')
            }}</UiButton>
          </AppearancePresetToolbar>
          <div v-if="loadingLocal" class="p-4 text-center text-text-secondary">{{ t('common.loading') }}</div>
          <ul
            v-else-if="filteredLocalThemes.length"
            class="m-0 max-h-[320px] list-none space-y-2 overflow-y-auto p-0.5"
          >
            <li
              v-for="theme in filteredLocalThemes"
              :key="theme.name"
              class="min-w-0 space-y-3 rounded-xl border border-border/60 bg-header/30 p-3 text-sm"
            >
              <div class="mb-2 flex min-w-0 items-center gap-2 md:mb-0">
                <span class="truncate font-medium text-foreground" :title="theme.name">{{
                  theme.name.replace(/\.html$/i, '')
                }}</span>
                <UiBadge>
                  {{ t(theme.type === 'preset' ? 'styleCustomizer.presetTag' : 'styleCustomizer.customTag') }}
                </UiBadge>
              </div>
              <div class="flex flex-wrap justify-start gap-2 md:justify-end">
                <UiButton density="compact" @click="applyLocalPreset(theme)">{{
                  t('styleCustomizer.applyButton')
                }}</UiButton>
                <UiButton density="compact" @click="openLocalPreset(theme)">{{ t('common.edit') }}</UiButton>
                <UiButton
                  v-if="theme.type === 'custom'"
                  density="compact"
                  appearance="solid"
                  tone="danger"
                  @click="deleteLocalPreset(theme)"
                >
                  {{ t('common.delete') }}
                </UiButton>
              </div>
            </li>
          </ul>
          <div v-else class="rounded-md border border-dashed border-border p-4 text-center italic text-text-secondary">
            {{
              localSearch ? t('styleCustomizer.noMatchingLocalPresetsFound') : t('styleCustomizer.noLocalPresetsFound')
            }}
          </div>
        </div>

        <div v-else>
          <UiFormField :label="t('styleCustomizer.remoteHtmlPresetsRepositoryUrl')">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <UiInput
                v-model="remoteRepositoryUrl"
                class="min-w-0 flex-grow"
                :placeholder="t('styleCustomizer.remoteRepoUrlPlaceholder')"
              />
              <UiButton density="compact" @click="saveRemoteRepository">{{ t('common.save') }}</UiButton>
              <UiButton density="compact" :disabled="!remoteRepositoryUrl || loadingRemote" @click="loadRemoteThemes">{{
                loadingRemote ? t('common.loading') : t('styleCustomizer.loadRemoteThemes')
              }}</UiButton>
            </div>
          </UiFormField>
          <AppearancePresetToolbar
            v-model="remoteSearch"
            class="my-4"
            :placeholder="t('styleCustomizer.searchRemoteThemesPlaceholder')"
          />
          <ul v-if="filteredRemoteThemes.length" class="m-0 max-h-[320px] list-none space-y-2 overflow-y-auto p-0.5">
            <li
              v-for="theme in filteredRemoteThemes"
              :key="theme.name"
              class="min-w-0 space-y-3 rounded-xl border border-border/60 bg-header/30 p-3 text-sm"
            >
              <span class="mb-2 truncate font-medium text-foreground md:mb-0">{{
                theme.name.replace(/\.html$/i, '')
              }}</span>
              <div class="flex justify-start md:justify-end">
                <UiButton density="compact" :disabled="!theme.downloadUrl" @click="applyRemotePreset(theme)">{{
                  t('styleCustomizer.applyButton')
                }}</UiButton>
              </div>
            </li>
          </ul>
          <div v-else class="rounded-md border border-dashed border-border p-4 text-center italic text-text-secondary">
            {{
              remoteSearch
                ? t('styleCustomizer.noMatchingRemotePresetsFound')
                : t('styleCustomizer.noRemotePresetsFound')
            }}
          </div>
        </div>
      </template>
      <div v-else class="rounded-md border border-dashed border-border/50 p-4 text-center italic text-text-secondary">
        {{ t('styleCustomizer.terminalBgDisabled') }}
      </div>

      <UiModal
        :visible="presetEditorVisible"
        :title="editingLocalName ? t('styleCustomizer.editLocalPreset') : t('styleCustomizer.newLocalPreset')"
        :z-index="1100"
        panel-class="w-[min(820px,94vw)]"
        @close="presetEditorVisible = false"
      >
        <div class="space-y-4">
          <UiFormField :label="t('styleCustomizer.presetName')">
            <UiInput v-model="presetName" :placeholder="t('styleCustomizer.presetNamePlaceholder')" />
          </UiFormField>
          <UiFormField :label="t('styleCustomizer.presetContent')">
            <UiTextarea v-model="presetContent" class="min-h-80 font-mono text-xs" />
          </UiFormField>
          <div class="flex justify-end gap-2">
            <UiButton @click="presetEditorVisible = false">{{ t('common.cancel') }}</UiButton>
            <UiButton appearance="solid" tone="primary" @click="saveLocalPreset">{{ t('common.save') }}</UiButton>
          </div>
        </div>
      </UiModal>
    </template>

    <template v-else>
      <div v-if="showPageBackground || showBackground" class="grid gap-4 md:grid-cols-2">
        <UiSurface v-if="showPageBackground" surface="inset" class="space-y-2 p-3">
          <h3 class="font-semibold">{{ t('styleCustomizer.pageBackground') }}</h3>
          <p class="break-all text-xs text-text-secondary">
            {{ store.settings.pageBackgroundImage || t('styleCustomizer.noBackground') }}
          </p>
          <UiInput type="file" accept="image/*" @change="uploadBackground('page', $event)" />
          <UiButton v-if="store.settings.pageBackgroundImage" density="compact" @click="removeBackground('page')">
            {{ t('styleCustomizer.removePageBg') }}
          </UiButton>
        </UiSurface>

        <UiSurface v-if="showBackground" surface="inset" class="space-y-2 p-3">
          <h3 class="font-semibold">{{ t('styleCustomizer.terminalBackground') }}</h3>
          <p class="break-all text-xs text-text-secondary">
            {{ store.settings.terminalBackgroundImage || t('styleCustomizer.noBackground') }}
          </p>
          <UiInput type="file" accept="image/*" @change="uploadBackground('terminal', $event)" />
          <UiButton
            v-if="store.settings.terminalBackgroundImage"
            density="compact"
            @click="removeBackground('terminal')"
          >
            {{ t('styleCustomizer.removeTerminalBg') }}
          </UiButton>
        </UiSurface>
      </div>

      <UiSurface v-if="showBackground" surface="inset" class="space-y-4 p-3">
        <label class="flex items-center gap-2">
          <UiCheckbox v-model="form.terminalBackgroundEnabled" />
          {{ t('styleCustomizer.terminalBackgroundEnabled') }}
        </label>
        <UiFormField :label="t('styleCustomizer.terminalBgOverlayOpacity')">
          <UiSlider
            v-model="form.terminalBackgroundOverlayOpacity"
            :min="0"
            :max="1"
            :step="0.05"
            :aria-label="t('styleCustomizer.terminalBgOverlayOpacity')"
          />
        </UiFormField>
        <UiFormField :label="t('styleCustomizer.presetContent')">
          <UiTextarea
            v-model="form.terminalCustomHtml"
            class="min-h-40 font-mono text-xs"
            :placeholder="t('styleCustomizer.customTerminalHTMLPlaceholder')"
          />
        </UiFormField>
        <div class="flex gap-2">
          <UiButton appearance="solid" tone="primary" @click="saveVisuals">{{ t('common.save') }}</UiButton>
          <UiButton @click="clearCustomHtml">{{ t('common.clear') }}</UiButton>
        </div>
      </UiSurface>

      <div v-if="showTextEffects" class="grid gap-4">
        <UiSurface surface="inset" class="min-w-0 space-y-3 p-3">
          <h3 class="font-semibold">{{ t('styleCustomizer.textStrokeSettings') }}</h3>
          <label class="flex items-center gap-2">
            <UiCheckbox v-model="form.terminalTextStrokeEnabled" />
            {{ t('styleCustomizer.enableTextStroke') }}
          </label>
          <UiFormField :label="t('styleCustomizer.textStrokeWidth')">
            <UiInput v-model="form.terminalTextStrokeWidth" type="number" />
          </UiFormField>
          <UiFormField :label="t('styleCustomizer.textStrokeColor')">
            <UiInput v-model="form.terminalTextStrokeColor" />
          </UiFormField>
        </UiSurface>

        <UiSurface surface="inset" class="min-w-0 space-y-3 p-3">
          <h3 class="font-semibold">{{ t('styleCustomizer.textShadowSettings') }}</h3>
          <label class="flex items-center gap-2">
            <UiCheckbox v-model="form.terminalTextShadowEnabled" />
            {{ t('styleCustomizer.enableTextShadow') }}
          </label>
          <div class="grid gap-2 sm:grid-cols-3">
            <UiFormField :label="t('styleCustomizer.textShadowOffsetX')">
              <UiInput v-model="form.terminalTextShadowOffsetX" type="number" />
            </UiFormField>
            <UiFormField :label="t('styleCustomizer.textShadowOffsetY')">
              <UiInput v-model="form.terminalTextShadowOffsetY" type="number" />
            </UiFormField>
            <UiFormField :label="t('styleCustomizer.textShadowBlur')">
              <UiInput v-model="form.terminalTextShadowBlur" type="number" />
            </UiFormField>
          </div>
          <UiFormField :label="t('styleCustomizer.textShadowColor')">
            <UiInput v-model="form.terminalTextShadowColor" />
          </UiFormField>
        </UiSurface>
      </div>
      <UiButton v-if="showTextEffects" appearance="solid" tone="primary" @click="saveVisuals">{{
        t('common.save')
      }}</UiButton>

      <div v-if="showBackground" class="grid gap-6 xl:grid-cols-2">
        <UiSurface surface="inset" class="min-w-0 space-y-3 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-semibold">{{ t('styleCustomizer.localThemes') }}</h3>
            <UiButton density="compact" appearance="solid" tone="primary" @click="openNewPreset">{{
              t('styleCustomizer.newLocalPreset')
            }}</UiButton>
          </div>
          <AppearancePresetToolbar
            v-model="localSearch"
            :placeholder="t('styleCustomizer.searchLocalThemesPlaceholder')"
          />
          <UiSpinner v-if="loadingLocal" />
          <ul v-else class="divide-y divide-border">
            <li v-for="theme in filteredLocalThemes" :key="theme.name" class="flex items-center gap-2 py-2">
              <span class="min-w-0 flex-1 truncate">{{ theme.name.replace(/\.html$/i, '') }}</span>
              <UiBadge>{{
                t(theme.type === 'preset' ? 'styleCustomizer.presetTag' : 'styleCustomizer.customTag')
              }}</UiBadge>
              <UiButton density="compact" @click="applyLocalPreset(theme)">{{
                t('styleCustomizer.applyButton')
              }}</UiButton>
              <UiButton density="compact" @click="openLocalPreset(theme)">{{
                theme.type === 'preset' ? t('styleCustomizer.editAsCopy') : t('common.edit')
              }}</UiButton>
              <UiButton
                v-if="theme.type === 'custom'"
                density="compact"
                appearance="solid"
                tone="danger"
                @click="deleteLocalPreset(theme)"
              >
                {{ t('common.delete') }}
              </UiButton>
            </li>
            <li v-if="!filteredLocalThemes.length" class="py-4 text-sm text-text-secondary">
              {{
                localSearch
                  ? t('styleCustomizer.noMatchingLocalPresetsFound')
                  : t('styleCustomizer.noLocalPresetsFound')
              }}
            </li>
          </ul>
        </UiSurface>

        <UiSurface surface="inset" class="min-w-0 space-y-3 p-3">
          <h3 class="font-semibold">{{ t('styleCustomizer.remoteThemes') }}</h3>
          <UiFormField :label="t('styleCustomizer.remoteHtmlPresetsRepositoryUrl')">
            <UiInput v-model="remoteRepositoryUrl" :placeholder="t('styleCustomizer.remoteRepoUrlPlaceholder')" />
          </UiFormField>
          <div class="flex gap-2">
            <UiButton density="compact" appearance="solid" tone="primary" @click="saveRemoteRepository">{{
              t('styleCustomizer.saveUrl')
            }}</UiButton>
            <UiButton density="compact" @click="loadRemoteThemes">{{ t('styleCustomizer.loadRemoteThemes') }}</UiButton>
          </div>
          <AppearancePresetToolbar
            v-model="remoteSearch"
            :placeholder="t('styleCustomizer.searchRemoteThemesPlaceholder')"
          />
          <UiSpinner v-if="loadingRemote" />
          <ul v-else class="divide-y divide-border">
            <li v-for="theme in filteredRemoteThemes" :key="theme.name" class="flex items-center gap-2 py-2">
              <span class="min-w-0 flex-1 truncate">{{ theme.name.replace(/\.html$/i, '') }}</span>
              <UiButton density="compact" :disabled="!theme.downloadUrl" @click="applyRemotePreset(theme)">
                {{ t('styleCustomizer.applyButton') }}
              </UiButton>
            </li>
            <li v-if="!filteredRemoteThemes.length" class="py-4 text-sm text-text-secondary">
              {{
                remoteSearch
                  ? t('styleCustomizer.noMatchingRemotePresetsFound')
                  : t('styleCustomizer.noRemotePresetsFound')
              }}
            </li>
          </ul>
        </UiSurface>
      </div>

      <UiModal
        v-if="showBackground"
        :visible="presetEditorVisible"
        :title="editingLocalName ? t('styleCustomizer.editLocalPreset') : t('styleCustomizer.newLocalPreset')"
        panel-class="w-[min(820px,94vw)]"
        @close="presetEditorVisible = false"
      >
        <div class="space-y-4">
          <UiFormField :label="t('styleCustomizer.presetName')">
            <UiInput v-model="presetName" :placeholder="t('styleCustomizer.presetNamePlaceholder')" />
          </UiFormField>
          <UiFormField :label="t('styleCustomizer.presetContent')">
            <UiTextarea v-model="presetContent" class="min-h-80 font-mono text-xs" />
          </UiFormField>
          <div class="flex justify-end gap-2">
            <UiButton @click="presetEditorVisible = false">{{ t('common.cancel') }}</UiButton>
            <UiButton appearance="solid" tone="primary" @click="saveLocalPreset">{{ t('common.save') }}</UiButton>
          </div>
        </div>
      </UiModal>
    </template>
  </section>
</template>
