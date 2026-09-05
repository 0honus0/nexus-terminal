<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { OverlayPanel } from '@/foundation/ui';
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
  <OverlayPanel
    :visible="visible"
    :z-index="1200"
    :close-on-backdrop="false"
    panel-class="max-w-md p-5"
    data-testid="upload-conflict-modal"
    role="dialog"
    :aria-modal="true"
    :aria-label="t('fileManager.uploadConflict.title')"
  >
    <div class="mb-4 flex items-start gap-3">
      <i class="fas fa-triangle-exclamation mt-1 text-warning" aria-hidden="true"></i>
      <div class="min-w-0">
        <h3 class="text-lg font-semibold">{{ t('fileManager.uploadConflict.title') }}</h3>
        <p class="mt-1 text-sm text-text-secondary">{{ t('fileManager.uploadConflict.description') }}</p>
      </div>
    </div>

    <div class="mb-4 rounded-md border border-border bg-header/50 px-3 py-2">
      <div data-testid="upload-conflict-filename" class="truncate font-medium" :title="filename">{{ filename }}</div>
      <div class="mt-1 truncate text-xs text-text-secondary" :title="path">{{ path }}</div>
    </div>

    <label class="mb-5 flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
      <input v-model="all" data-testid="upload-conflict-apply-all" type="checkbox" class="accent-primary" />
      {{ t('fileManager.uploadConflict.applyToAll') }}
    </label>

    <div class="flex justify-end gap-2">
      <button
        type="button"
        data-testid="upload-conflict-skip"
        class="rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-header"
        @click="emit('resolve', 'skip', all)"
      >
        {{ t('fileManager.uploadConflict.skip') }}
      </button>
      <button
        type="button"
        data-testid="upload-conflict-overwrite"
        class="rounded-md bg-primary px-4 py-2 text-sm text-white hover:opacity-90"
        @click="emit('resolve', 'overwrite', all)"
      >
        {{ t('fileManager.uploadConflict.overwrite') }}
      </button>
    </div>
  </OverlayPanel>
</template>
