<script setup lang="ts">
  import { computed, onMounted, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseFormField, BaseInput, BaseTextarea } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { darkUiTheme, defaultUiTheme, defaultWindowThemeColor } from '../config/default-theme';
  import { useAppearanceStore } from '../store/appearance.store';
  import { formatThemeObject, parseThemeObject } from '../model/themeEditor';

  type AppearanceSection = 'all' | 'ui' | 'terminal' | 'other';
  const props = withDefaults(defineProps<{ section?: AppearanceSection; showUiActions?: boolean }>(), {
    section: 'all',
    showUiActions: true,
  });

  const { t } = useI18n();
  const feedback = useFeedback();
  const store = useAppearanceStore();
  const form = reactive({
    terminalFontFamily: '',
    terminalFontSize: 14,
    terminalFontSizeMobile: 14,
    editorFontFamily: '',
    editorFontSize: 14,
    mobileEditorFontSize: 16,
    windowThemeColor: defaultWindowThemeColor,
  });
  const uiTheme = reactive<Record<string, string>>({ ...defaultUiTheme });
  const uiThemeJson = ref(formatThemeObject(uiTheme));
  const uiThemeParseError = ref('');
  const rawThemeEditing = ref(false);

  const showWindow = computed(() => props.section === 'all');
  const showTerminal = computed(() => props.section === 'all' || props.section === 'terminal');
  const showEditor = computed(() => props.section === 'all' || props.section === 'other');
  const showUi = computed(() => props.section === 'all' || props.section === 'ui');

  const sync = (): void => {
    Object.assign(form, {
      terminalFontFamily: store.settings.terminalFontFamily ?? '',
      terminalFontSize: store.settings.terminalFontSize ?? 14,
      terminalFontSizeMobile: store.settings.terminalFontSizeMobile ?? 14,
      editorFontFamily: store.settings.editorFontFamily ?? '',
      editorFontSize: store.settings.editorFontSize ?? 14,
      mobileEditorFontSize: store.settings.mobileEditorFontSize ?? 16,
      windowThemeColor: store.settings.windowThemeColor ?? defaultWindowThemeColor,
    });

    try {
      Object.assign(uiTheme, defaultUiTheme, JSON.parse(store.settings.customUiTheme ?? '{}'));
    } catch {
      Object.assign(uiTheme, defaultUiTheme);
    }
    uiThemeJson.value = formatThemeObject(uiTheme);
    uiThemeParseError.value = '';
  };

  watch(() => store.settings, sync, { deep: true });
  watch(
    uiTheme,
    () => {
      if (!rawThemeEditing.value) uiThemeJson.value = formatThemeObject(uiTheme);
    },
    { deep: true },
  );
  onMounted(sync);

  const savePatch = async (patch: Record<string, unknown>): Promise<void> => {
    try {
      await store.update(patch);
      feedback.notifySuccess(t('common.saved'));
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : t('common.errorOccurred'));
    }
  };

  const saveWindow = (): Promise<void> => savePatch({ windowThemeColor: form.windowThemeColor });
  const saveTerminal = (): Promise<void> =>
    savePatch({
      terminalFontFamily: form.terminalFontFamily,
      terminalFontSize: form.terminalFontSize,
      terminalFontSizeMobile: form.terminalFontSizeMobile,
    });
  const saveEditor = (): Promise<void> =>
    savePatch({
      editorFontFamily: form.editorFontFamily,
      editorFontSize: form.editorFontSize,
      mobileEditorFontSize: form.mobileEditorFontSize,
    });
  const saveGeneral = (): Promise<void> => savePatch({ ...form });

  const applyUiThemeJson = (): boolean => {
    const parsed = parseThemeObject(uiThemeJson.value);
    if (!parsed.value) {
      uiThemeParseError.value = t(
        parsed.error === 'object-required' || parsed.error === 'string-values-required'
          ? 'styleCustomizer.errorInvalidJsonObject'
          : 'styleCustomizer.uiThemeParseError',
        { message: parsed.error ?? '' },
      );
      return false;
    }
    for (const key of Object.keys(uiTheme)) delete uiTheme[key];
    Object.assign(uiTheme, defaultUiTheme, parsed.value);
    uiThemeParseError.value = '';
    uiThemeJson.value = formatThemeObject(uiTheme);
    return true;
  };

  const saveUiTheme = async (): Promise<void> => {
    if (rawThemeEditing.value && !applyUiThemeJson()) return;
    try {
      await store.saveUiTheme({ ...uiTheme });
      feedback.notifySuccess(t('common.saved'));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.uiThemeSaveFailed', { message: String(cause) }));
    }
  };

  const resetUiTheme = async (): Promise<void> => {
    Object.assign(uiTheme, defaultUiTheme);
    try {
      await store.saveUiTheme({ ...defaultUiTheme });
      feedback.notifySuccess(t('styleCustomizer.uiThemeReset'));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.uiThemeResetFailed', { message: String(cause) }));
    }
  };

  const applyDarkMode = async (): Promise<void> => {
    Object.assign(uiTheme, darkUiTheme);
    try {
      await store.saveUiTheme({ ...darkUiTheme });
      feedback.notifySuccess(t('styleCustomizer.darkModeApplied'));
    } catch (cause) {
      feedback.notifyError(t('styleCustomizer.darkModeApplyFailed', { message: String(cause) }));
    }
  };

  const resetWindowColor = (): void => {
    form.windowThemeColor = defaultWindowThemeColor;
  };

  const formatLabel = (key: string): string =>
    key
      .replace(/^--/, '')
      .replace(/-/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (value) => value.toUpperCase());

  const isColorValue = (value: string): boolean =>
    value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl');

  const selectInputText = (event: FocusEvent): void => {
    const target = event.target;
    if (target instanceof HTMLInputElement) target.select();
  };

  defineExpose({ saveUiTheme, resetUiTheme });
</script>

<template>
  <section class="space-y-6">
    <section v-if="showWindow" class="space-y-4">
      <div class="grid gap-4 md:grid-cols-2">
        <BaseFormField :label="t('settings.appearance.windowThemeColor.label')">
          <div class="flex gap-2">
            <input v-model="form.windowThemeColor" type="color" class="h-10 w-14" />
            <BaseInput v-model="form.windowThemeColor" data-testid="window-theme-color-input" />
          </div>
        </BaseFormField>
        <div class="flex items-end gap-2">
          <BaseButton data-testid="window-theme-color-save" variant="primary" @click="saveWindow">{{
            t('common.save')
          }}</BaseButton>
          <BaseButton @click="resetWindowColor">{{ t('common.restore') }}</BaseButton>
        </div>
      </div>
    </section>

    <section v-if="showTerminal" class="space-y-4">
      <h3
        v-if="props.section === 'terminal'"
        class="mt-0 border-b border-border pb-2 text-lg font-semibold text-foreground"
      >
        {{ t('styleCustomizer.terminalStyles') }}
      </h3>
      <div class="grid gap-4 md:grid-cols-3">
        <BaseFormField :label="t('styleCustomizer.terminalFontFamily')">
          <BaseInput v-model="form.terminalFontFamily" />
        </BaseFormField>
        <BaseFormField :label="t('styleCustomizer.terminalFontSize')">
          <BaseInput v-model="form.terminalFontSize" type="number" />
        </BaseFormField>
        <BaseFormField :label="t('styleCustomizer.terminalFontSizeMobile')">
          <BaseInput v-model="form.terminalFontSizeMobile" type="number" />
        </BaseFormField>
      </div>
      <BaseButton v-if="props.section !== 'all'" @click="saveTerminal">{{ t('common.save') }}</BaseButton>
    </section>

    <section v-if="showEditor" class="space-y-4">
      <h3
        v-if="props.section === 'other'"
        class="mt-0 border-b border-border pb-2 text-lg font-semibold text-foreground"
      >
        {{ t('styleCustomizer.otherSettings') }}
      </h3>
      <div class="grid gap-4 md:grid-cols-3">
        <BaseFormField :label="t('styleCustomizer.editorFontFamily')">
          <BaseInput v-model="form.editorFontFamily" />
        </BaseFormField>
        <BaseFormField :label="t('styleCustomizer.editorFontSize')">
          <BaseInput v-model="form.editorFontSize" type="number" />
        </BaseFormField>
        <BaseFormField :label="t('styleCustomizer.editorFontSizeMobile')">
          <BaseInput v-model="form.mobileEditorFontSize" type="number" />
        </BaseFormField>
      </div>
      <BaseButton v-if="props.section !== 'all'" @click="saveEditor">{{ t('common.save') }}</BaseButton>
    </section>

    <BaseButton v-if="props.section === 'all'" variant="primary" @click="saveGeneral">{{
      t('common.save')
    }}</BaseButton>

    <section v-if="showUi">
      <h3
        v-if="props.section === 'ui'"
        class="mb-4 mt-0 border-b border-border pb-2 text-lg font-semibold text-foreground"
      >
        {{ t('styleCustomizer.uiStyles') }}
      </h3>
      <div class="mb-6 grid grid-cols-1 items-start gap-2 md:grid-cols-[auto_1fr] md:items-center md:gap-3">
        <span class="mb-1 text-left text-sm font-medium text-foreground md:mb-0">{{
          t('styleCustomizer.themeModeLabel')
        }}</span>
        <div class="flex flex-wrap justify-start gap-2">
          <BaseButton data-testid="theme-default-mode" size="sm" @click="resetUiTheme">{{
            t('styleCustomizer.defaultMode')
          }}</BaseButton>
          <BaseButton data-testid="theme-dark-mode" size="sm" @click="applyDarkMode">{{
            t('styleCustomizer.darkMode')
          }}</BaseButton>
        </div>
      </div>
      <p class="mb-3 text-sm leading-relaxed text-text-secondary">{{ t('styleCustomizer.uiDescription') }}</p>

      <div
        v-for="(value, key) in uiTheme"
        :key="key"
        class="mb-3 grid grid-cols-1 items-start gap-x-3 gap-y-1 md:grid-cols-[auto_1fr] md:items-center"
      >
        <label
          :for="`ui-${key}`"
          class="mb-1 block w-full overflow-hidden text-ellipsis text-left text-sm font-medium text-foreground md:mb-0"
        >
          {{ formatLabel(String(key)) }}:
        </label>
        <div class="flex w-full items-center gap-2">
          <input
            v-if="isColorValue(value)"
            :id="`ui-${key}`"
            v-model="uiTheme[key]"
            type="color"
            class="h-[34px] min-w-[40px] max-w-[50px] shrink-0 rounded border border-border p-0.5 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            v-if="isColorValue(value)"
            :value="uiTheme[key]"
            type="text"
            class="min-w-[80px] flex-grow cursor-text rounded border border-border bg-background px-[0.7rem] py-2 text-sm text-foreground transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            @focus="selectInputText"
            @input="uiTheme[key] = ($event.target as HTMLInputElement).value"
          />
          <input
            v-else
            :id="`ui-${key}`"
            v-model="uiTheme[key]"
            type="text"
            class="w-full rounded border border-border bg-background px-[0.7rem] py-2 text-sm text-foreground transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <hr class="my-8 border-border" />
      <h4 class="mb-2 mt-6 text-base font-semibold text-foreground">
        {{ t('styleCustomizer.uiThemeJsonEditorTitle') }}
      </h4>
      <p class="mb-3 text-sm leading-relaxed text-text-secondary">{{ t('styleCustomizer.uiThemeJsonEditorDesc') }}</p>
      <div class="mt-4">
        <BaseTextarea
          v-model="uiThemeJson"
          class="min-h-[200px] resize-y whitespace-pre-wrap break-words p-3 font-mono text-sm leading-snug"
          rows="15"
          spellcheck="false"
          @focus="rawThemeEditing = true"
          @blur="
            rawThemeEditing = false;
            applyUiThemeJson();
          "
        />
        <p
          v-if="uiThemeParseError"
          class="mt-2 rounded border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
        >
          {{ uiThemeParseError }}
        </p>
      </div>
      <div v-if="props.showUiActions" class="mt-4 flex gap-2">
        <BaseButton variant="primary" @click="saveUiTheme">{{ t('common.save') }}</BaseButton>
        <BaseButton @click="resetUiTheme">{{ t('common.restore') }}</BaseButton>
      </div>
    </section>
  </section>
</template>
