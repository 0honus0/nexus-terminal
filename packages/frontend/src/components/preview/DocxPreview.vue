<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { renderAsync } from 'docx-preview';
import type { FileListItem } from '../../types/sftp.types';
import FilePreviewDialog from './FilePreviewDialog.vue';
import PreviewHorizontalScrollbar from './PreviewHorizontalScrollbar.vue';

const props = withDefaults(defineProps<{
  file: FileListItem;
  buffer: ArrayBuffer;
  active?: boolean;
}>(), {
  active: true,
});

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const scrollerRef = ref<HTMLElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const isRendering = ref(true);
const renderError = ref('');
let rendered = false;
let renderToken = 0;

const renderDocument = async () => {
  if (rendered || !containerRef.value) return;
  const token = ++renderToken;
  isRendering.value = true;
  renderError.value = '';

  try {
    await renderAsync(props.buffer, containerRef.value, undefined, {
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      useBase64URL: true,
    });
    if (token === renderToken) rendered = true;
  } catch (error) {
    console.error('[DocxPreview] Failed to render DOCX', error);
    if (token === renderToken) {
      renderError.value = t('fileManager.preview.docxLoadFailed', 'The DOCX document could not be displayed.');
    }
  } finally {
    if (token === renderToken) isRendering.value = false;
  }
};

onMounted(() => {
  void nextTick(renderDocument);
});

watch(() => props.active, (active) => {
  if (active && !rendered) void nextTick(renderDocument);
});

watch(() => props.buffer, () => {
  renderToken += 1;
  rendered = false;
  renderError.value = '';
  if (containerRef.value) containerRef.value.replaceChildren();
  if (props.active) void nextTick(renderDocument);
});
</script>

<template>
  <FilePreviewDialog
    :file="props.file"
    :subtitle="t('fileManager.preview.docx', 'Word document')"
    :active="props.active"
    @close="emit('close')"
  >
    <div class="flex h-full min-h-[18rem] flex-col overflow-hidden" data-testid="docx-preview">
      <div
        ref="scrollerRef"
        data-testid="docx-preview-scroller"
        class="relative min-h-0 flex-1 overflow-auto bg-black/10 p-3 md:p-6"
      >
        <div
          v-if="isRendering"
          class="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/80 text-sm text-text-secondary"
          aria-live="polite"
        >
          <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
          <span>{{ t('fileManager.preview.loading', 'Loading preview...') }}</span>
        </div>
        <div
          v-if="renderError"
          class="mx-auto max-w-xl rounded-md border border-error/40 bg-error/10 p-4 text-sm text-error"
          role="alert"
        >
          {{ renderError }}
        </div>
        <div ref="containerRef" class="docx-preview-host" />
      </div>

      <PreviewHorizontalScrollbar
        :target="scrollerRef"
        test-id="docx-horizontal-scrollbar"
        :active="props.active"
        :label="t('fileManager.preview.horizontalScroll', 'Horizontal scroll')"
      />
    </div>
  </FilePreviewDialog>
</template>

<style scoped>
.docx-preview-host :deep(.docx-wrapper) {
  background: transparent;
  padding: 0;
}

.docx-preview-host :deep(.docx) {
  margin: 0 auto 1rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
</style>
