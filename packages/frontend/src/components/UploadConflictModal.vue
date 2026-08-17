<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { UploadConflictDecision, UploadConflictPrompt } from '../composables/useFileUploader';

const props = defineProps<{
  conflict: UploadConflictPrompt | null;
}>();

const emit = defineEmits<{
  (e: 'resolve', decision: UploadConflictDecision, applyToAll: boolean): void;
}>();

const { t } = useI18n();
const applyToAll = ref(false);

watch(
  () => props.conflict?.uploadId,
  () => {
    applyToAll.value = false;
  },
);

const resolve = (decision: UploadConflictDecision) => {
  if (!props.conflict) return;
  emit('resolve', decision, applyToAll.value);
};
</script>

<template>
  <div
    v-if="conflict"
    data-testid="upload-conflict-modal"
    class="fixed inset-0 z-[1200] flex items-center justify-center bg-overlay p-4"
    role="dialog"
    aria-modal="true"
  >
    <div class="w-full max-w-md rounded-lg border border-border bg-background p-5 text-foreground shadow-xl">
      <div class="mb-4 flex items-start gap-3">
        <i class="fas fa-triangle-exclamation mt-1 text-warning" aria-hidden="true"></i>
        <div class="min-w-0">
          <h3 class="text-lg font-semibold">
            {{ t('fileManager.uploadConflict.title', 'File already exists') }}
          </h3>
          <p class="mt-1 text-sm text-text-secondary">
            {{ t('fileManager.uploadConflict.description', 'A file with the same name already exists at the destination.') }}
          </p>
        </div>
      </div>

      <div class="mb-4 rounded-md border border-border bg-header/50 px-3 py-2">
        <div class="truncate font-medium" data-testid="upload-conflict-filename" :title="conflict.filename">
          {{ conflict.filename }}
        </div>
        <div class="mt-1 truncate text-xs text-text-secondary" :title="conflict.remotePath">
          {{ conflict.remotePath }}
        </div>
      </div>

      <label class="mb-5 flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
        <input
          v-model="applyToAll"
          data-testid="upload-conflict-apply-all"
          type="checkbox"
          class="accent-primary"
        />
        {{ t('fileManager.uploadConflict.applyToAll', 'Use this choice for all remaining conflicts in this upload') }}
      </label>

      <div class="flex justify-end gap-2">
        <button
          type="button"
          data-testid="upload-conflict-skip"
          class="rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-header"
          @click="resolve('skip')"
        >
          {{ t('fileManager.uploadConflict.skip', 'Skip this file') }}
        </button>
        <button
          type="button"
          data-testid="upload-conflict-overwrite"
          class="rounded-md bg-primary px-4 py-2 text-sm text-white hover:opacity-90"
          @click="resolve('overwrite')"
        >
          {{ t('fileManager.uploadConflict.overwrite', 'Overwrite') }}
        </button>
      </div>
    </div>
  </div>
</template>
