<template>
  <div v-if="settings" class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
    <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">
      {{ $t('settings.category.appearance') }}
    </h2>
    <div class="p-6 space-y-6">
      <!-- Style Customizer -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.appearance.title') }}</h3>
        <p class="text-sm text-text-secondary mb-4">{{ $t('settings.appearance.description') }}</p>
        <button
          @click="openStyleCustomizer"
          class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
        >
          {{ t('settings.appearance.customizeButton') }}
        </button>
      </div>
      <hr class="border-border/50" />
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ t('settings.appearance.windowThemeColor.title') }}
        </h3>
        <p class="text-sm text-text-secondary mb-4">{{ t('settings.appearance.windowThemeColor.description') }}</p>
        <label for="windowThemeColorInput" class="block text-sm font-medium text-foreground mb-2">
          {{ t('settings.appearance.windowThemeColor.label') }}
        </label>
        <div class="flex flex-wrap items-center gap-3">
          <input
            data-testid="window-theme-color-picker"
            type="color"
            :value="windowThemeColorDraft"
            @input="handleWindowThemeColorPicker"
            class="h-10 w-14 rounded border border-border bg-background cursor-pointer"
          />
          <input
            id="windowThemeColorInput"
            data-testid="window-theme-color-input"
            v-model.trim="windowThemeColorDraft"
            type="text"
            maxlength="7"
            spellcheck="false"
            autocomplete="off"
            class="h-10 w-32 px-3 border border-border rounded-md bg-input text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            @input="windowThemeColorStatus = null"
            @keyup.enter="saveWindowThemeColor"
          />
          <button
            data-testid="window-theme-color-save"
            type="button"
            :disabled="isSavingWindowThemeColor || !isWindowThemeColorValid"
            @click="saveWindowThemeColor"
            class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
          >
            {{ t('settings.appearance.windowThemeColor.save') }}
          </button>
          <button
            data-testid="window-theme-color-reset"
            type="button"
            :disabled="isSavingWindowThemeColor"
            @click="resetWindowThemeColor"
            class="px-4 py-2 border border-border text-foreground rounded-md hover:bg-header/70 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
          >
            {{ t('settings.appearance.windowThemeColor.reset') }}
          </button>
        </div>
        <p v-if="!isWindowThemeColorValid" class="text-sm text-error mt-2" data-testid="window-theme-color-invalid">
          {{ t('settings.appearance.windowThemeColor.invalid') }}
        </p>
        <p
          v-else-if="windowThemeColorStatus === 'saved'"
          class="text-sm text-success mt-2"
          data-testid="window-theme-color-saved"
        >
          {{ t('settings.appearance.windowThemeColor.saved') }}
        </p>
        <p
          v-else-if="windowThemeColorStatus === 'error'"
          class="text-sm text-error mt-2"
          data-testid="window-theme-color-error"
        >
          {{ t('settings.appearance.windowThemeColor.saveFailed') }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useSettingsStore } from '../../stores/settings.store';
  import { useAppearanceStore } from '../../stores/appearance.store';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { useAppearanceSettings } from '../../composables/settings/useAppearanceSettings';
  import { computed, ref, watch } from 'vue';

  const settingsStore = useSettingsStore();
  const { settings } = storeToRefs(settingsStore);
  const appearanceStore = useAppearanceStore();
  const { t } = useI18n();

  const { openStyleCustomizer } = useAppearanceSettings();

  const DEFAULT_WINDOW_THEME_COLOR = '#343A40';
  const windowThemeColorDraft = ref(DEFAULT_WINDOW_THEME_COLOR);
  const isSavingWindowThemeColor = ref(false);
  const windowThemeColorStatus = ref<'saved' | 'error' | null>(null);

  const normalizeWindowThemeColor = (color: string): string | null => {
    const value = color.trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null;
  };

  const isWindowThemeColorValid = computed(() => normalizeWindowThemeColor(windowThemeColorDraft.value) !== null);

  watch(
    () => appearanceStore.currentWindowThemeColor,
    (color) => {
      windowThemeColorDraft.value = color;
    },
    { immediate: true },
  );

  const handleWindowThemeColorPicker = (event: Event) => {
    const target = event.target as HTMLInputElement;
    windowThemeColorDraft.value = target.value.toUpperCase();
    windowThemeColorStatus.value = null;
  };

  const saveWindowThemeColor = async () => {
    const color = normalizeWindowThemeColor(windowThemeColorDraft.value);
    if (!color || isSavingWindowThemeColor.value) return;
    isSavingWindowThemeColor.value = true;
    windowThemeColorStatus.value = null;
    try {
      await appearanceStore.updateAppearanceSettings({ windowThemeColor: color });
      windowThemeColorDraft.value = color;
      windowThemeColorStatus.value = 'saved';
    } catch (error) {
      console.error('[AppearanceSection] 保存窗口标题栏颜色失败:', error);
      windowThemeColorStatus.value = 'error';
    } finally {
      isSavingWindowThemeColor.value = false;
    }
  };

  const resetWindowThemeColor = async () => {
    windowThemeColorDraft.value = DEFAULT_WINDOW_THEME_COLOR;
    await saveWindowThemeColor();
  };
</script>
