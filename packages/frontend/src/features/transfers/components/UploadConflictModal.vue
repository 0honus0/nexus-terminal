<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { UiButton, UiCheckbox, UiOverlayPanel } from '@/foundation/ui';
  const props = defineProps<{ visible: boolean; path?: string }>();
  const emit = defineEmits<{ resolve: [strategy: 'overwrite' | 'skip', applyToAll: boolean] }>();
  const { t } = useI18n();
  const all = ref(false);
  const filename = computed(() => props.path?.split(/[\/]/).filter(Boolean).at(-1) || props.path || '');
  watch(
    () => [props.visible, props.path] as const,
    ([visible], previous) => {
      if (visible && (!previous || !previous[0] || previous[1] !== props.path)) all.value = false;
    },
  );
</script>
<template>
  <UiOverlayPanel
    :visible="visible"
    :z-index="1200"
    :close-on-backdrop="false"
    panel-class="ui-form-surface ui-confirmation-panel"
    data-testid="upload-conflict-modal"
    role="dialog"
    :aria-modal="true"
    :aria-label="t('fileManager.uploadConflict.title')"
  >
    <div class="ui-confirmation-panel__body">
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
        <i class="fas fa-triangle-exclamation !text-current" aria-hidden="true"></i>
      </div>
      <div class="min-w-0">
        <h3 class="text-lg font-semibold">{{ t('fileManager.uploadConflict.title') }}</h3>
        <p class="mt-1 text-sm text-text-secondary">{{ t('fileManager.uploadConflict.description') }}</p>
      </div>
    </div>

    <div class="ui-solid-inset mx-5 mb-4 rounded-xl px-3 py-3 sm:mx-6">
      <div data-testid="upload-conflict-filename" class="break-words font-medium" :title="filename">{{ filename }}</div>
      <div class="mt-1 break-all text-xs text-text-secondary">{{ path }}</div>
    </div>

    <label class="mx-5 mb-5 flex cursor-pointer items-center gap-2 text-sm text-text-secondary sm:mx-6">
      <UiCheckbox v-model="all" data-testid="upload-conflict-apply-all" />
      {{ t('fileManager.uploadConflict.applyToAll') }}
    </label>

    <div class="ui-confirmation-panel__actions">
      <UiButton
        type="button"
        data-testid="upload-conflict-skip"
        appearance="soft"
        @click="emit('resolve', 'skip', all)"
      >
        {{ t('fileManager.uploadConflict.skip') }}
      </UiButton>
      <UiButton
        type="button"
        data-testid="upload-conflict-overwrite"
        appearance="solid"
        tone="danger"
        @click="emit('resolve', 'overwrite', all)"
      >
        {{ t('fileManager.uploadConflict.overwrite') }}
      </UiButton>
    </div>
  </UiOverlayPanel>
</template>
