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

    <section v-if="showUi" class="space-y-3">
      <h3 v-if="props.section === 'ui'" class="mt-0 border-b border-border pb-2 text-lg font-semibold text-foreground">
        {{ t('styleCustomizer.uiStyles') }}
      </h3>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm font-medium text-foreground">{{ t('styleCustomizer.themeModeLabel') }}</span>
        <div class="flex items-center gap-2">
          <BaseButton data-testid="theme-default-mode" size="sm" @click="resetUiTheme">{{
            t('styleCustomizer.defaultMode')
          }}</BaseButton>
          <BaseButton data-testid="theme-dark-mode" size="sm" @click="applyDarkMode">{{
            t('styleCustomizer.darkMode')
          }}</BaseButton>
        </div>
      </div>
      <p class="text-sm leading-relaxed text-text-secondary">{{ t('styleCustomizer.uiDescription') }}</p>
      <div class="grid gap-3 md:grid-cols-3">
        <BaseFormField v-for="(_, key) in uiTheme" :key="key" :label="String(key)">
          <BaseInput v-model="uiTheme[key]" />
        </BaseFormField>
      </div>
      <BaseFormField :label="t('styleCustomizer.uiThemeJsonEditorTitle')">
        <p class="mb-2 text-xs text-text-secondary">{{ t('styleCustomizer.uiThemeJsonEditorDesc') }}</p>
        <BaseTextarea
          v-model="uiThemeJson"
          class="min-h-64 font-mono text-xs"
          @focus="rawThemeEditing = true"
          @blur="
            rawThemeEditing = false;
            applyUiThemeJson();
          "
        />
        <p v-if="uiThemeParseError" class="mt-2 text-sm text-error">{{ uiThemeParseError }}</p>
      </BaseFormField>
      <div v-if="props.showUiActions" class="flex gap-2">
        <BaseButton variant="primary" @click="saveUiTheme">{{ t('common.save') }}</BaseButton>
        <BaseButton @click="resetUiTheme">{{ t('common.restore') }}</BaseButton>
      </div>
    </section>
  </section>
</template>
