<script setup lang="ts">
  import { computed, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    BaseButton,
    BaseFormField,
    BaseInput,
    BaseModal,
    BaseSelect,
    BaseTable,
    BaseTextarea,
  } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { appearanceApi } from '../api/appearanceApi';
  import type { TerminalTheme } from '../model/appearance';
  import { formatThemeObject, parseThemeObject } from '../model/themeEditor';
  import { useAppearanceStore } from '../store/appearance.store';

  const { t } = useI18n();
  const feedback = useFeedback();
  const store = useAppearanceStore();
  const editorVisible = ref(false);
  const editingTheme = ref<TerminalTheme | null>(null);
  const themeName = ref('');
  const themeDraft = reactive<Record<string, string>>({});
  const themeJson = ref('{}');
  const themeParseError = ref('');
  const rawThemeEditing = ref(false);
  const importInput = ref<HTMLInputElement | null>(null);
  const search = ref('');

  const activeThemeId = computed(() => store.settings.activeTerminalThemeId ?? '');
  const activeTheme = computed(
    () => store.themes.find((theme) => theme.id === store.settings.activeTerminalThemeId) ?? null,
  );
  const sortedThemes = computed(() => [...store.themes].sort((left, right) => left.name.localeCompare(right.name)));
  const filteredThemes = computed(() => {
    const query = search.value.trim().toLowerCase();
    return query ? sortedThemes.value.filter((theme) => theme.name.toLowerCase().includes(query)) : sortedThemes.value;
  });
  const themeFields = computed(() => Object.keys(themeDraft).sort((left, right) => left.localeCompare(right)));

  const replaceThemeDraft = (value: Record<string, string>): void => {
    for (const key of Object.keys(themeDraft)) delete themeDraft[key];
    Object.assign(themeDraft, value);
    themeJson.value = formatThemeObject(themeDraft);
    themeParseError.value = '';
  };

  watch(
    themeDraft,
    () => {
      if (!rawThemeEditing.value) themeJson.value = formatThemeObject(themeDraft);
    },
    { deep: true },
  );

  const applyTheme = async (id: number | null): Promise<void> => {
    try {
      await store.update({ activeTerminalThemeId: id });
      const name = store.themes.find((theme) => theme.id === id)?.name ?? t('styleCustomizer.defaultTheme');
      feedback.notifySuccess(t('styleCustomizer.setActiveThemeSuccess', { themeName: name }));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.setActiveThemeFailed', { message: String(cause) }));
    }
  };

  const setActiveTheme = (event: Event): Promise<void> =>
    applyTheme(Number((event.target as HTMLSelectElement).value) || null);

  const openCreate = (): void => {
    editingTheme.value = null;
    themeName.value = t('styleCustomizer.newThemeDefaultName');
    replaceThemeDraft({ background: '#000000', foreground: '#ffffff' });
    editorVisible.value = true;
  };

  const openEdit = (theme: TerminalTheme): void => {
    editingTheme.value = theme.preset ? null : theme;
    themeName.value = theme.preset ? t('styleCustomizer.themeCopyName', { name: theme.name }) : theme.name;
    replaceThemeDraft(theme.themeData);
    editorVisible.value = true;
  };

  const applyThemeJson = (): boolean => {
    const parsed = parseThemeObject(themeJson.value);
    if (!parsed.value) {
      themeParseError.value =
        parsed.error === 'object-required' || parsed.error === 'string-values-required'
          ? t('styleCustomizer.errorInvalidJsonObject')
          : t('styleCustomizer.terminalThemeParseError', { message: parsed.error ?? '' });
      return false;
    }
    replaceThemeDraft(parsed.value);
    return true;
  };

  const finishRawThemeEditing = (): void => {
    rawThemeEditing.value = false;
    window.setTimeout(() => {
      if (!rawThemeEditing.value && editorVisible.value) applyThemeJson();
    }, 0);
  };

  const saveTheme = async (): Promise<void> => {
    if (!themeName.value.trim()) {
      feedback.notifyWarning(t('styleCustomizer.errorThemeNameRequired'));
      return;
    }
    if (!applyThemeJson()) {
      feedback.notifyError(t('styleCustomizer.errorFixJsonBeforeSave'));
      return;
    }

    const themeData = { ...themeDraft };
    try {
      if (editingTheme.value) {
        await appearanceApi.updateTheme(editingTheme.value.id, themeName.value.trim(), themeData);
        feedback.notifySuccess(t('styleCustomizer.themeUpdatedSuccess'));
      } else {
        await appearanceApi.createTheme(themeName.value.trim(), themeData);
        feedback.notifySuccess(t('styleCustomizer.themeCreatedSuccess'));
      }
      editorVisible.value = false;
      await store.refreshThemes();
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : t('styleCustomizer.themeSaveFailed'));
    }
  };

  const removeTheme = async (theme: TerminalTheme): Promise<void> => {
    if (theme.preset) {
      feedback.notifyWarning(t('styleCustomizer.cannotDeletePreset'));
      return;
    }
    if (
      !(await feedback.confirm({
        message: t('styleCustomizer.confirmDeleteTheme', { name: theme.name }),
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await appearanceApi.deleteTheme(theme.id);
      if (store.settings.activeTerminalThemeId === theme.id) await store.update({ activeTerminalThemeId: null });
      await store.refreshThemes();
      feedback.notifySuccess(t('styleCustomizer.themeDeletedSuccess'));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.themeDeleteFailed', { message: String(cause) }));
    }
  };

  const importTheme = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await appearanceApi.importTheme(file);
      await store.refreshThemes();
      feedback.notifySuccess(t('styleCustomizer.importSuccess'));
    } catch (cause) {
      feedback.notifyError(`${t('styleCustomizer.importFailed')} ${String(cause)}`);
    } finally {
      input.value = '';
    }
  };

  const exportActive = async (): Promise<void> => {
    if (!activeTheme.value) return;
    const fileName = `${activeTheme.value.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    try {
      await appearanceApi.exportTheme(activeTheme.value.id, fileName);
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.exportFailed', { message: String(cause) }));
    }
  };

  const labelForThemeField = (key: string): string =>
    key.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase());
</script>

<template>
  <section data-testid="terminal-style-settings" class="space-y-4">
    <div class="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
      <BaseSelect :model-value="String(activeThemeId)" @change="setActiveTheme">
        <option value="">{{ t('styleCustomizer.defaultTheme') }}</option>
        <option v-for="theme in sortedThemes" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
      </BaseSelect>
      <BaseButton data-testid="terminal-theme-add" variant="primary" @click="openCreate">{{
        t('styleCustomizer.addNewTheme')
      }}</BaseButton>
      <BaseButton @click="importInput?.click()">{{ t('styleCustomizer.importTheme') }}</BaseButton>
      <BaseButton :disabled="!activeTheme" @click="exportActive">{{
        t('styleCustomizer.exportActiveTheme')
      }}</BaseButton>
      <input ref="importInput" class="hidden" type="file" accept="application/json,.json" @change="importTheme" />
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <BaseInput
        v-model="search"
        data-testid="terminal-theme-search"
        class="max-w-sm"
        :placeholder="t('styleCustomizer.searchThemePlaceholder')"
      />
      <p class="text-sm text-text-secondary">
        {{ t('styleCustomizer.activeTheme') }}
        <strong data-testid="terminal-active-theme-name" class="text-foreground">{{
          activeTheme?.name || t('styleCustomizer.defaultTheme')
        }}</strong>
      </p>
    </div>

    <BaseTable :empty="filteredThemes.length === 0" :empty-text="t('styleCustomizer.noThemesFound')">
      <template #head>
        <tr>
          <th class="px-3 py-2">{{ t('styleCustomizer.themeName') }}</th>
          <th class="px-3 py-2"></th>
        </tr>
      </template>
      <tr v-for="theme in filteredThemes" :key="theme.id" :data-testid="`terminal-theme-row-${theme.id}`">
        <td class="px-3 py-2">{{ theme.name }}</td>
        <td class="px-3 py-2 text-right">
          <div class="flex justify-end gap-1">
            <BaseButton
              data-testid="terminal-theme-apply"
              size="sm"
              :disabled="theme.id === store.settings.activeTerminalThemeId"
              @click="applyTheme(theme.id)"
            >
              {{ t('styleCustomizer.applyButton') }}
            </BaseButton>
            <BaseButton data-testid="terminal-theme-edit" size="sm" @click="openEdit(theme)">{{
              theme.preset ? t('styleCustomizer.editAsCopy') : t('common.edit')
            }}</BaseButton>
            <BaseButton
              v-if="!theme.preset"
              data-testid="terminal-theme-delete"
              size="sm"
              variant="danger"
              @click="removeTheme(theme)"
            >
              {{ t('common.delete') }}
            </BaseButton>
          </div>
        </td>
      </tr>
    </BaseTable>

    <BaseModal
      :visible="editorVisible"
      :title="editingTheme ? t('styleCustomizer.editThemeTitle') : t('styleCustomizer.newThemeTitle')"
      panel-class="w-[min(820px,94vw)] max-h-[90vh] overflow-auto"
      @close="editorVisible = false"
    >
      <div data-testid="terminal-theme-editor" class="space-y-5">
        <BaseFormField :label="t('styleCustomizer.themeName')">
          <BaseInput v-model="themeName" data-testid="terminal-theme-name" />
        </BaseFormField>

        <section class="space-y-3">
          <h3 class="font-semibold">{{ t('styleCustomizer.terminalThemeColorEditorTitle') }}</h3>
          <div class="grid gap-3 md:grid-cols-2">
            <BaseFormField v-for="key in themeFields" :key="key" :label="labelForThemeField(key)">
              <div class="flex items-center gap-2">
                <input
                  v-if="themeDraft[key]?.startsWith('#')"
                  v-model="themeDraft[key]"
                  type="color"
                  class="h-9 w-12 shrink-0 rounded border border-border"
                />
                <BaseInput v-model="themeDraft[key]" class="min-w-0 flex-1" />
              </div>
            </BaseFormField>
          </div>
        </section>

        <BaseFormField :label="t('styleCustomizer.terminalThemeJsonEditorTitle')">
          <p class="mb-2 text-xs text-text-secondary">{{ t('styleCustomizer.terminalThemeJsonEditorDesc') }}</p>
          <BaseTextarea
            v-model="themeJson"
            data-testid="terminal-theme-json"
            class="min-h-72 font-mono text-xs"
            spellcheck="false"
            @focus="rawThemeEditing = true"
            @blur="finishRawThemeEditing"
          />
          <p v-if="themeParseError" class="mt-2 text-sm text-error">{{ themeParseError }}</p>
        </BaseFormField>
        <div class="flex justify-end gap-2">
          <BaseButton @click="editorVisible = false">{{ t('common.cancel') }}</BaseButton>
          <BaseButton data-testid="terminal-theme-save" variant="primary" @click="saveTheme">{{
            t('common.save')
          }}</BaseButton>
        </div>
      </div>
    </BaseModal>
  </section>
</template>
