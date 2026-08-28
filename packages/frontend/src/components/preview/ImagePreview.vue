<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../../types/sftp.types';
import FilePreviewDialog from './FilePreviewDialog.vue';

const props = withDefaults(defineProps<{
  file: FileListItem;
  src: string;
  active?: boolean;
}>(), {
  active: true,
});

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const isLoading = ref(true);
const hasError = ref(false);
</script>

<template>
  <FilePreviewDialog
    :file="props.file"
    :subtitle="t('fileManager.preview.image', 'Image')"
    :active="props.active"
    @close="emit('close')"
  >
    <div class="relative flex h-full min-h-[18rem] items-center justify-center overflow-auto bg-black/80 p-4">
      <div v-if="isLoading && !hasError" class="file-image-preview-status" aria-live="polite">
        <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
        <span>{{ t('fileManager.preview.loading', 'Loading preview...') }}</span>
      </div>

      <div v-if="hasError" class="file-image-preview-status" role="alert">
        <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
        <span>{{ t('fileManager.preview.imageLoadFailed', 'The image could not be displayed.') }}</span>
      </div>

      <img
        v-show="!hasError"
        class="max-h-full max-w-full select-none object-contain"
        :src="props.src"
        :alt="props.file.filename"
        decoding="async"
        @load="isLoading = false"
        @error="isLoading = false; hasError = true"
      >
    </div>
  </FilePreviewDialog>
</template>

<style scoped>
.file-image-preview-status {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 0.5rem;
  color: white;
  background: rgba(20, 20, 20, 0.9);
}
</style>
