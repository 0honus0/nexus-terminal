<script setup lang="ts">
  import { onBeforeUnmount, ref, watchEffect } from 'vue';
  import { useI18n } from 'vue-i18n';
  import FilePreviewDialog from './FilePreviewDialog.vue';
  import type { FilePreviewSessionController } from '../composables/useFilePreviewTabs';
  import type { PreviewFile } from '../model/preview';

  const props = withDefaults(
    defineProps<{ file: PreviewFile; session: FilePreviewSessionController; active?: boolean }>(),
    { active: true },
  );
  const emit = defineEmits<{ close: [] }>();
  const { t } = useI18n();
  const url = ref('');
  const loading = ref(true);
  const failed = ref(false);
  const inferredMimeType = (): string => {
    const extension = props.file.name.split('.').pop()?.toLowerCase();
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
    if (extension === 'png') return 'image/png';
    if (extension === 'gif') return 'image/gif';
    if (extension === 'webp') return 'image/webp';
    if (extension === 'bmp') return 'image/bmp';
    if (extension === 'ico') return 'image/x-icon';
    if (extension === 'avif') return 'image/avif';
    return 'application/octet-stream';
  };
  watchEffect(() => {
    if (url.value) URL.revokeObjectURL(url.value);
    loading.value = true;
    failed.value = false;
    url.value = URL.createObjectURL(new Blob([props.file.bytes], { type: props.file.mimeType || inferredMimeType() }));
  });
  onBeforeUnmount(() => {
    if (url.value) URL.revokeObjectURL(url.value);
  });
</script>

<template>
  <FilePreviewDialog
    :file="file"
    :session="session"
    :subtitle="t('fileManager.preview.image')"
    :active="active"
    @close="emit('close')"
  >
    <div class="relative flex h-full min-h-[18rem] items-center justify-center overflow-auto bg-black/80 p-4">
      <div v-if="loading && !failed" class="file-image-preview-status" aria-live="polite">
        <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
        <span>{{ t('fileManager.preview.loading') }}</span>
      </div>
      <div v-if="failed" class="file-image-preview-status" role="alert">
        <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
        <span>{{ t('fileManager.preview.imageLoadFailed') }}</span>
      </div>
      <img
        v-show="!failed"
        :src="url"
        :alt="file.name"
        class="max-h-full max-w-full select-none object-contain"
        decoding="async"
        @load="loading = false"
        @error="
          loading = false;
          failed = true;
        "
      />
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
    border: 1px solid rgb(255 255 255 / 25%);
    border-radius: 0.5rem;
    background: rgb(20 20 20 / 90%);
    color: white;
  }
</style>
