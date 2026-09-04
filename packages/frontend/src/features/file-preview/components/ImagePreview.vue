<script setup lang="ts">
  import { onBeforeUnmount, ref, watchEffect } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseSpinner } from '@/foundation/ui';
  const props = defineProps<{ bytes: ArrayBuffer; mimeType?: string; name?: string }>();
  const { t } = useI18n();
  const url = ref('');
  const loading = ref(true);
  const failed = ref(false);
  const inferredMimeType = (): string => {
    const extension = props.name?.split('.').pop()?.toLowerCase();
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
    url.value = URL.createObjectURL(new Blob([props.bytes], { type: props.mimeType || inferredMimeType() }));
  });
  onBeforeUnmount(() => {
    if (url.value) URL.revokeObjectURL(url.value);
  });
</script>
<template>
  <div class="relative grid h-full place-items-center overflow-auto bg-black/80 p-4">
    <div
      v-if="loading && !failed"
      class="absolute flex items-center gap-2 rounded border border-border bg-background/90 p-3 text-sm text-foreground"
    >
      <BaseSpinner />
      <span>{{ t('fileManager.preview.loading') }}</span>
    </div>
    <p
      v-if="failed"
      class="absolute rounded border border-error/40 bg-background/90 p-3 text-sm text-error"
      role="alert"
    >
      {{ t('fileManager.preview.imageLoadFailed') }}
    </p>
    <img
      v-show="!failed"
      :src="url"
      :alt="name"
      class="max-h-full max-w-full select-none object-contain"
      decoding="async"
      @load="loading = false"
      @error="
        loading = false;
        failed = true;
      "
    />
  </div>
</template>
