<script setup lang="ts">
  import { computed, onMounted, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    BaseBadge,
    BaseButton,
    BaseCheckbox,
    BaseFormField,
    BaseInput,
    BaseModal,
    BaseSpinner,
    BaseTextarea,
  } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { appearanceApi } from '../api/appearanceApi';
  import type { LocalHtmlTheme, RemoteHtmlTheme } from '../model/appearance';
  import { useAppearanceStore } from '../store/appearance.store';

  const { t } = useI18n();
  const feedback = useFeedback();
  const store = useAppearanceStore();
  const localThemes = ref<LocalHtmlTheme[]>([]);
  const remoteThemes = ref<RemoteHtmlTheme[]>([]);
  const loadingLocal = ref(false);
  const loadingRemote = ref(false);
  const remoteRepositoryUrl = ref('');
  const presetEditorVisible = ref(false);
  const editingLocalName = ref<string | null>(null);
  const presetName = ref('');
  const presetContent = ref('');
  const localSearch = ref('');
  const remoteSearch = ref('');

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

  watch(() => store.settings, sync, { deep: true });

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
      await appearanceApi.uploadBackground(kind, file);
      await store.load(true);
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
      await store.load(true);
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

  const openLocalPreset = async (theme: LocalHtmlTheme): Promise<void> => {
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

  const applyLocalPreset = async (theme: LocalHtmlTheme): Promise<void> => {
    try {
      const content = await appearanceApi.readLocalHtmlTheme(theme.name);
      await store.update({ terminalCustomHtml: content, terminalBackgroundEnabled: true });
      feedback.notifySuccess(t('styleCustomizer.htmlPresetApplied'));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.localPresetApplyFailed', { message: String(cause) }));
    }
  };

  const deleteLocalPreset = async (theme: LocalHtmlTheme): Promise<void> => {
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

  const applyRemotePreset = async (theme: RemoteHtmlTheme): Promise<void> => {
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
  <section class="space-y-8">
    <div class="grid gap-4 md:grid-cols-2">
      <div class="space-y-2 rounded border border-border p-4">
        <h3 class="font-semibold">{{ t('styleCustomizer.pageBackground') }}</h3>
        <p class="break-all text-xs text-text-secondary">
          {{ store.settings.pageBackgroundImage || t('styleCustomizer.noBackground') }}
        </p>
        <input type="file" accept="image/*" @change="uploadBackground('page', $event)" />
        <BaseButton v-if="store.settings.pageBackgroundImage" size="sm" @click="removeBackground('page')">
          {{ t('styleCustomizer.removePageBg') }}
        </BaseButton>
      </div>

      <div class="space-y-2 rounded border border-border p-4">
        <h3 class="font-semibold">{{ t('styleCustomizer.terminalBackground') }}</h3>
        <p class="break-all text-xs text-text-secondary">
          {{ store.settings.terminalBackgroundImage || t('styleCustomizer.noBackground') }}
        </p>
        <input type="file" accept="image/*" @change="uploadBackground('terminal', $event)" />
        <BaseButton v-if="store.settings.terminalBackgroundImage" size="sm" @click="removeBackground('terminal')">
          {{ t('styleCustomizer.removeTerminalBg') }}
        </BaseButton>
      </div>
    </div>

    <div class="space-y-4 rounded border border-border p-4">
      <label class="flex items-center gap-2">
        <BaseCheckbox v-model="form.terminalBackgroundEnabled" />
        {{ t('styleCustomizer.terminalBackgroundEnabled') }}
      </label>
      <BaseFormField :label="t('styleCustomizer.terminalBgOverlayOpacity')">
        <input
          v-model.number="form.terminalBackgroundOverlayOpacity"
          type="range"
          min="0"
          max="1"
          step="0.05"
          class="w-full"
        />
      </BaseFormField>
      <BaseFormField :label="t('styleCustomizer.presetContent')">
        <BaseTextarea
          v-model="form.terminalCustomHtml"
          class="min-h-40 font-mono text-xs"
          :placeholder="t('styleCustomizer.customTerminalHTMLPlaceholder')"
        />
      </BaseFormField>
      <div class="flex gap-2">
        <BaseButton variant="primary" @click="saveVisuals">{{ t('common.save') }}</BaseButton>
        <BaseButton @click="clearCustomHtml">{{ t('common.clear') }}</BaseButton>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="space-y-3 rounded border border-border p-4">
        <h3 class="font-semibold">{{ t('styleCustomizer.textStrokeSettings') }}</h3>
        <label class="flex items-center gap-2">
          <BaseCheckbox v-model="form.terminalTextStrokeEnabled" />
          {{ t('styleCustomizer.enableTextStroke') }}
        </label>
        <BaseFormField :label="t('styleCustomizer.textStrokeWidth')">
          <BaseInput v-model="form.terminalTextStrokeWidth" type="number" />
        </BaseFormField>
        <BaseFormField :label="t('styleCustomizer.textStrokeColor')">
          <BaseInput v-model="form.terminalTextStrokeColor" />
        </BaseFormField>
      </div>

      <div class="space-y-3 rounded border border-border p-4">
        <h3 class="font-semibold">{{ t('styleCustomizer.textShadowSettings') }}</h3>
        <label class="flex items-center gap-2">
          <BaseCheckbox v-model="form.terminalTextShadowEnabled" />
          {{ t('styleCustomizer.enableTextShadow') }}
        </label>
        <div class="grid grid-cols-3 gap-2">
          <BaseFormField :label="t('styleCustomizer.textShadowOffsetX')">
            <BaseInput v-model="form.terminalTextShadowOffsetX" type="number" />
          </BaseFormField>
          <BaseFormField :label="t('styleCustomizer.textShadowOffsetY')">
            <BaseInput v-model="form.terminalTextShadowOffsetY" type="number" />
          </BaseFormField>
          <BaseFormField :label="t('styleCustomizer.textShadowBlur')">
            <BaseInput v-model="form.terminalTextShadowBlur" type="number" />
          </BaseFormField>
        </div>
        <BaseFormField :label="t('styleCustomizer.textShadowColor')">
          <BaseInput v-model="form.terminalTextShadowColor" />
        </BaseFormField>
      </div>
    </div>
    <BaseButton variant="primary" @click="saveVisuals">{{ t('common.save') }}</BaseButton>

    <div class="grid gap-6 xl:grid-cols-2">
      <div class="space-y-3 rounded border border-border p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-semibold">{{ t('styleCustomizer.localThemes') }}</h3>
          <BaseButton size="sm" variant="primary" @click="openNewPreset">{{
            t('styleCustomizer.newLocalPreset')
          }}</BaseButton>
        </div>
        <BaseInput v-model="localSearch" :placeholder="t('styleCustomizer.searchLocalThemesPlaceholder')" />
        <BaseSpinner v-if="loadingLocal" />
        <ul v-else class="divide-y divide-border">
          <li v-for="theme in filteredLocalThemes" :key="theme.name" class="flex items-center gap-2 py-2">
            <span class="min-w-0 flex-1 truncate">{{ theme.name.replace(/\.html$/i, '') }}</span>
            <BaseBadge>{{
              t(theme.type === 'preset' ? 'styleCustomizer.presetTag' : 'styleCustomizer.customTag')
            }}</BaseBadge>
            <BaseButton size="sm" @click="applyLocalPreset(theme)">{{ t('styleCustomizer.applyButton') }}</BaseButton>
            <BaseButton size="sm" @click="openLocalPreset(theme)">{{
              theme.type === 'preset' ? t('styleCustomizer.editAsCopy') : t('common.edit')
            }}</BaseButton>
            <BaseButton v-if="theme.type === 'custom'" size="sm" variant="danger" @click="deleteLocalPreset(theme)">
              {{ t('common.delete') }}
            </BaseButton>
          </li>
          <li v-if="!filteredLocalThemes.length" class="py-4 text-sm text-text-secondary">
            {{
              localSearch ? t('styleCustomizer.noMatchingLocalPresetsFound') : t('styleCustomizer.noLocalPresetsFound')
            }}
          </li>
        </ul>
      </div>

      <div class="space-y-3 rounded border border-border p-4">
        <h3 class="font-semibold">{{ t('styleCustomizer.remoteThemes') }}</h3>
        <BaseFormField :label="t('styleCustomizer.remoteHtmlPresetsRepositoryUrl')">
          <BaseInput v-model="remoteRepositoryUrl" :placeholder="t('styleCustomizer.remoteRepoUrlPlaceholder')" />
        </BaseFormField>
        <div class="flex gap-2">
          <BaseButton size="sm" variant="primary" @click="saveRemoteRepository">{{
            t('styleCustomizer.saveUrl')
          }}</BaseButton>
          <BaseButton size="sm" @click="loadRemoteThemes">{{ t('styleCustomizer.loadRemoteThemes') }}</BaseButton>
        </div>
        <BaseInput v-model="remoteSearch" :placeholder="t('styleCustomizer.searchRemoteThemesPlaceholder')" />
        <BaseSpinner v-if="loadingRemote" />
        <ul v-else class="divide-y divide-border">
          <li v-for="theme in filteredRemoteThemes" :key="theme.name" class="flex items-center gap-2 py-2">
            <span class="min-w-0 flex-1 truncate">{{ theme.name.replace(/\.html$/i, '') }}</span>
            <BaseButton size="sm" :disabled="!theme.downloadUrl" @click="applyRemotePreset(theme)">
              {{ t('styleCustomizer.applyButton') }}
            </BaseButton>
          </li>
          <li v-if="!filteredRemoteThemes.length" class="py-4 text-sm text-text-secondary">
            {{
              remoteSearch
                ? t('styleCustomizer.noMatchingRemotePresetsFound')
                : t('styleCustomizer.noRemotePresetsFound')
            }}
          </li>
        </ul>
      </div>
    </div>

    <BaseModal
      :visible="presetEditorVisible"
      :title="editingLocalName ? t('styleCustomizer.editLocalPreset') : t('styleCustomizer.newLocalPreset')"
      panel-class="w-[min(820px,94vw)]"
      @close="presetEditorVisible = false"
    >
      <div class="space-y-4">
        <BaseFormField :label="t('styleCustomizer.presetName')">
          <BaseInput v-model="presetName" :placeholder="t('styleCustomizer.presetNamePlaceholder')" />
        </BaseFormField>
        <BaseFormField :label="t('styleCustomizer.presetContent')">
          <BaseTextarea v-model="presetContent" class="min-h-80 font-mono text-xs" />
        </BaseFormField>
        <div class="flex justify-end gap-2">
          <BaseButton @click="presetEditorVisible = false">{{ t('common.cancel') }}</BaseButton>
          <BaseButton variant="primary" @click="saveLocalPreset">{{ t('common.save') }}</BaseButton>
        </div>
      </div>
    </BaseModal>
  </section>
</template>
