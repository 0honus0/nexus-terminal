<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseInput } from '@/foundation/ui';
  import { defaultWindowThemeColor } from '../config/default-theme';
  import { useAppearanceStore } from '../store/appearance.store';

  const emit = defineEmits<{ customize: [] }>();
  const { t } = useI18n();
  const store = useAppearanceStore();
  const draft = ref(defaultWindowThemeColor);
  const saving = ref(false);
  const status = ref<'saved' | 'error' | null>(null);
  const normalize = (value: string): string | null => {
    const trimmed = value.trim();
    return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toUpperCase() : null;
  };
  const valid = computed(() => normalize(draft.value) !== null);
  const sync = (): void => {
    draft.value = (store.settings.windowThemeColor ?? defaultWindowThemeColor).toUpperCase();
    status.value = null;
  };
  watch(() => store.settings.windowThemeColor, sync);
  onMounted(async () => {
    await store.load();
    sync();
  });
  const save = async (): Promise<void> => {
    const value = normalize(draft.value);
    if (!value || saving.value) return;
    saving.value = true;
    status.value = null;
    try {
      await store.update({ windowThemeColor: value });
      draft.value = value;
      status.value = 'saved';
    } catch {
      status.value = 'error';
    } finally {
      saving.value = false;
    }
  };
  const reset = async (): Promise<void> => {
    draft.value = defaultWindowThemeColor;
    await save();
  };
  const pick = (event: Event): void => {
    draft.value = (event.target as HTMLInputElement).value.toUpperCase();
    status.value = null;
  };
</script>

<template>
  <section
    data-testid="appearance-settings-panel"
    class="overflow-hidden rounded-lg border border-border bg-background shadow-sm"
  >
    <h2 class="border-b border-border bg-header/50 px-6 py-4 text-lg font-semibold text-foreground">
      {{ t('settings.category.appearance') }}
    </h2>
    <div class="space-y-6 p-6">
      <div>
        <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.appearance.title') }}</h3>
        <p class="mb-4 text-sm text-text-secondary">{{ t('settings.appearance.description') }}</p>
        <BaseButton variant="primary" @click="emit('customize')">
          {{ t('settings.appearance.customizeButton') }}
        </BaseButton>
      </div>

      <hr class="border-border/50" />

      <div>
        <h3 class="mb-3 text-base font-semibold text-foreground">
          {{ t('settings.appearance.windowThemeColor.title') }}
        </h3>
        <p class="mb-4 text-sm text-text-secondary">{{ t('settings.appearance.windowThemeColor.description') }}</p>
        <label for="windowThemeColorInput" class="mb-2 block text-sm font-medium text-foreground">
          {{ t('settings.appearance.windowThemeColor.label') }}
        </label>
        <div class="flex flex-wrap items-center gap-3">
          <input
            data-testid="window-theme-color-picker"
            type="color"
            :value="draft"
            class="h-10 w-14 cursor-pointer rounded border border-border bg-background"
            @input="pick"
          />
          <BaseInput
            id="windowThemeColorInput"
            v-model="draft"
            data-testid="window-theme-color-input"
            maxlength="7"
            spellcheck="false"
            autocomplete="off"
            class="h-10 !w-32 font-mono"
            @input="status = null"
            @keyup.enter="save"
          />
          <BaseButton
            data-testid="window-theme-color-save"
            variant="primary"
            :disabled="saving || !valid"
            :loading="saving"
            @click="save"
          >
            {{ t('settings.appearance.windowThemeColor.save') }}
          </BaseButton>
          <BaseButton data-testid="window-theme-color-reset" :disabled="saving" @click="reset">
            {{ t('settings.appearance.windowThemeColor.reset') }}
          </BaseButton>
        </div>
        <p v-if="!valid" class="mt-2 text-sm text-error" data-testid="window-theme-color-invalid">
          {{ t('settings.appearance.windowThemeColor.invalid') }}
        </p>
        <p v-else-if="status === 'saved'" class="mt-2 text-sm text-success" data-testid="window-theme-color-saved">
          {{ t('settings.appearance.windowThemeColor.saved') }}
        </p>
        <p v-else-if="status === 'error'" class="mt-2 text-sm text-error" data-testid="window-theme-color-error">
          {{ t('settings.appearance.windowThemeColor.saveFailed') }}
        </p>
      </div>
    </div>
  </section>
</template>
