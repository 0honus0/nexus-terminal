<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../../types/sftp.types';

const emit = defineEmits<{
  close: [];
}>();

const props = defineProps<{
  file: FileListItem;
  src: string;
}>();

const { t } = useI18n();
const dialogRef = ref<HTMLElement | null>(null);
const isLoading = ref(true);
const hasError = ref(false);
let previouslyFocusedElement: HTMLElement | null = null;

const close = () => emit('close');

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
};

onMounted(() => {
  previouslyFocusedElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  document.addEventListener('keydown', handleKeydown);
  void nextTick(() => dialogRef.value?.focus());
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
  previouslyFocusedElement?.focus({ preventScroll: true });
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="dialogRef"
      class="file-image-preview"
      role="dialog"
      aria-modal="true"
      :aria-label="file.filename"
      tabindex="-1"
      @click.self="close"
    >
      <button
        type="button"
        class="file-image-preview-close"
        :aria-label="t('fileManager.preview.close', 'Close preview')"
        @click="close"
      >
        ×
      </button>

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
        :src="props.src"
        :alt="file.filename"
        decoding="async"
        @load="isLoading = false"
        @error="isLoading = false; hasError = true"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.file-image-preview {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.82);
  outline: none;
}

.file-image-preview img {
  max-width: 92vw;
  max-height: 92vh;
  object-fit: contain;
  user-select: none;
}

.file-image-preview-close {
  position: fixed;
  top: 1rem;
  right: 1rem;
  width: 2.5rem;
  height: 2.5rem;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 9999px;
  color: white;
  background: rgba(0, 0, 0, 0.45);
  font-size: 1.75rem;
  line-height: 1;
  cursor: pointer;
}

.file-image-preview-close:focus-visible {
  outline: 2px solid white;
  outline-offset: 2px;
}

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
