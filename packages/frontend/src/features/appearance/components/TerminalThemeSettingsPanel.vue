<script setup lang="ts">
  import { computed, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseFormField, BaseInput, BaseTextarea } from '@/foundation/ui';
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
  <section data-testid="terminal-style-settings">
    <template v-if="!editorVisible">
      <h4 class="mb-2 mt-6 text-base font-semibold text-foreground">
        {{ t('styleCustomizer.terminalThemeSelection') }}
      </h4>

      <div
        class="mb-4 flex flex-col items-start gap-1 py-2 text-sm md:flex-row md:items-center md:gap-3 md:text-[0.95rem]"
      >
        <span class="text-text-secondary">{{ t('styleCustomizer.activeTheme') }}:</span>
        <strong data-testid="terminal-active-theme-name" class="font-semibold text-foreground">
          {{ activeTheme?.name || t('styleCustomizer.defaultTheme') }}
        </strong>
      </div>

      <div class="mb-6 mt-4 flex flex-wrap items-center gap-2 border-b border-dashed border-border pb-4">
        <BaseButton data-testid="terminal-theme-add" size="sm" @click="openCreate">{{
          t('styleCustomizer.addNewTheme')
        }}</BaseButton>
        <BaseButton size="sm" @click="importInput?.click()">{{ t('styleCustomizer.importTheme') }}</BaseButton>
        <BaseButton size="sm" :disabled="!activeTheme" @click="exportActive">{{
          t('styleCustomizer.exportActiveTheme')
        }}</BaseButton>
        <input ref="importInput" class="hidden" type="file" accept="application/json,.json" @change="importTheme" />
      </div>

      <div class="mb-4">
        <BaseInput
          v-model="search"
          data-testid="terminal-theme-search"
          :placeholder="t('styleCustomizer.searchThemePlaceholder')"
        />
      </div>

      <ul
        class="mt-4 max-h-[200px] list-none overflow-y-auto rounded border border-border bg-background p-0 md:max-h-[280px]"
      >
        <li v-if="filteredThemes.length === 0" class="p-4 text-center italic text-text-secondary">
          {{ t('styleCustomizer.noThemesFound') }}
        </li>
        <li
          v-for="(theme, index) in filteredThemes"
          v-else
          :key="theme.id"
          :data-testid="`terminal-theme-row-${theme.id}`"
          :class="[
            'block items-center gap-2 px-3 py-2.5 text-sm transition-colors duration-200 ease-in-out md:grid md:grid-cols-[1fr_auto] md:text-[0.95rem]',
            index < filteredThemes.length - 1 ? 'border-b border-border' : '',
            theme.id === store.settings.activeTerminalThemeId ? 'bg-button text-button-text' : 'hover:bg-header',
          ]"
        >
          <span
            class="mb-2 block overflow-hidden text-ellipsis whitespace-nowrap md:mb-0"
            :class="
              theme.id === store.settings.activeTerminalThemeId ? 'font-bold text-button-text' : 'text-foreground'
            "
            :title="theme.name"
          >
            {{ theme.name }}
          </span>
          <div class="flex flex-wrap justify-start gap-2 md:justify-end">
            <button
              data-testid="terminal-theme-apply"
              type="button"
              :disabled="theme.id === store.settings.activeTerminalThemeId"
              :class="[
                'whitespace-nowrap rounded border px-3 py-1.5 text-xs transition-colors duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-60 md:text-sm',
                theme.id === store.settings.activeTerminalThemeId
                  ? 'border-white/30 bg-white/10 text-button-text disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:opacity-50'
                  : 'border-border bg-header text-foreground hover:border-text-secondary hover:bg-border',
              ]"
              @click="applyTheme(theme.id)"
            >
              {{ t('styleCustomizer.applyButton') }}
            </button>
            <button
              data-testid="terminal-theme-edit"
              type="button"
              :class="[
                'whitespace-nowrap rounded border px-3 py-1.5 text-xs transition-colors duration-200 ease-in-out md:text-sm',
                theme.id === store.settings.activeTerminalThemeId
                  ? 'border-white/30 bg-white/10 text-button-text hover:border-white/50 hover:bg-white/20'
                  : 'border-border bg-header text-foreground hover:border-text-secondary hover:bg-border',
              ]"
              @click="openEdit(theme)"
            >
              {{ theme.preset ? t('styleCustomizer.editAsCopy') : t('common.edit') }}
            </button>
            <button
              v-if="!theme.preset"
              data-testid="terminal-theme-delete"
              type="button"
              class="whitespace-nowrap rounded border border-error/30 bg-error/10 px-3 py-1.5 text-xs text-error transition-colors duration-200 ease-in-out hover:bg-error/20 md:text-sm"
              @click="removeTheme(theme)"
            >
              {{ t('common.delete') }}
            </button>
          </div>
        </li>
      </ul>
    </template>

    <section v-else data-testid="terminal-theme-editor">
      <h3 class="mb-4 mt-0 border-b border-border pb-2 text-lg font-semibold text-foreground">
        {{ editingTheme ? t('styleCustomizer.editThemeTitle') : t('styleCustomizer.newThemeTitle') }}
      </h3>

      <div class="mb-2 grid grid-cols-1 items-start gap-2 md:grid-cols-[auto_1fr] md:items-center">
        <label class="block w-full overflow-hidden text-ellipsis text-left text-sm font-medium text-foreground md:mb-0">
          {{ t('styleCustomizer.themeName') }}:
        </label>
        <BaseInput v-model="themeName" data-testid="terminal-theme-name" />
      </div>

      <hr class="my-4 border-border md:my-8" />
      <h4 class="mb-2 mt-6 text-base font-semibold text-foreground">
        {{ t('styleCustomizer.terminalThemeColorEditorTitle') }}
      </h4>
      <div
        v-for="key in themeFields"
        :key="key"
        class="mb-2 grid grid-cols-1 items-start gap-2 md:grid-cols-[auto_1fr] md:items-center"
      >
        <label class="block w-full overflow-hidden text-ellipsis text-left text-sm font-medium text-foreground">
          {{ labelForThemeField(key) }}:
        </label>
        <div class="flex w-full items-center gap-2">
          <input
            v-if="themeDraft[key]?.startsWith('#')"
            v-model="themeDraft[key]"
            type="color"
            class="h-[34px] min-w-[40px] max-w-[50px] shrink-0 rounded border border-border p-0.5"
          />
          <BaseInput v-model="themeDraft[key]" class="min-w-[80px] flex-1" />
        </div>
      </div>

      <hr class="my-4 border-border md:my-8" />
      <h4 class="mb-2 mt-6 text-base font-semibold text-foreground">
        {{ t('styleCustomizer.terminalThemeJsonEditorTitle') }}
      </h4>
      <p class="mb-3 text-sm leading-relaxed text-text-secondary">
        {{ t('styleCustomizer.terminalThemeJsonEditorDesc') }}
      </p>
      <BaseFormField :label="t('styleCustomizer.terminalThemeJsonEditorTitle')" class="mt-4">
        <BaseTextarea
          v-model="themeJson"
          data-testid="terminal-theme-json"
          class="min-h-[150px] resize-y whitespace-pre-wrap break-words font-mono text-sm leading-snug md:min-h-[200px]"
          spellcheck="false"
          @focus="rawThemeEditing = true"
          @blur="finishRawThemeEditing"
        />
        <p v-if="themeParseError" class="mt-2 rounded border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {{ themeParseError }}
        </p>
      </BaseFormField>

      <div class="mt-4 flex justify-end gap-2 border-t border-border pt-4">
        <BaseButton data-testid="terminal-theme-cancel" @click="editorVisible = false">{{
          t('common.cancel')
        }}</BaseButton>
        <BaseButton data-testid="terminal-theme-save" variant="primary" @click="saveTheme">{{
          t('common.save')
        }}</BaseButton>
      </div>
    </section>
  </section>
</template>
