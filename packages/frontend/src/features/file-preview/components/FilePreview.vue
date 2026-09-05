<script setup lang="ts">
  import { defineAsyncComponent } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseSpinner } from '@/foundation/ui';
  import ImagePreview from './ImagePreview.vue';

  const MarkdownPreview = defineAsyncComponent({
    loader: () => import('./MarkdownPreview.vue'),
    loadingComponent: BaseSpinner,
    delay: 120,
  });
  const PdfPreview = defineAsyncComponent({
    loader: () => import('./PdfPreview.vue'),
    loadingComponent: BaseSpinner,
    delay: 120,
  });
  const SpreadsheetPreview = defineAsyncComponent({
    loader: () => import('./SpreadsheetPreview.vue'),
    loadingComponent: BaseSpinner,
    delay: 120,
  });
  const DocxPreview = defineAsyncComponent({
    loader: () => import('./DocxPreview.vue'),
    loadingComponent: BaseSpinner,
    delay: 120,
  });

  import { createFilePreviewSession, type FilePreviewSessionController } from '../composables/useFilePreviewTabs';
  import type { FilePreviewSource } from '../ports/file-preview-source';

  const props = defineProps<{
    source: FilePreviewSource;
    scopeId?: string;
    session?: FilePreviewSessionController;
    spreadsheetRowsPerPage?: number;
    spreadsheetMaxColumns?: number;
  }>();
  const emit = defineEmits<{ edit: [path: string]; hide: [] }>();
  const { t } = useI18n();
  const preview = props.session ?? createFilePreviewSession(props.source);

  const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };
  const previewError = (tab: (typeof preview.tabs.value)[number]): string => {
    if (!tab.error) return '';
    if (tab.error.type === 'tooLarge') {
      return t('fileManager.preview.fileTooLarge', { size: formatBytes(tab.error.maxBytes) });
    }
    return tab.error.message;
  };
  const open = (path: string) => preview.open(path, { scopeId: props.scopeId, source: props.source });

  defineExpose({ open, close: preview.close, clear: preview.clear, refresh: preview.refresh });
</script>

<template>
  <section data-testid="file-preview-view" class="relative flex h-full min-h-0 flex-col bg-background">
    <template v-for="tab in preview.tabs.value" :key="tab.id">
      <div v-show="preview.activeId.value === tab.id" class="absolute inset-0 min-h-0">
        <BaseSpinner v-if="tab.loading" class="m-6" />
        <p v-else-if="tab.error" class="p-4 text-error">{{ previewError(tab) }}</p>
        <template v-else-if="tab.file">
          <ImagePreview
            v-if="tab.kind === 'image'"
            :file="tab.file"
            :session="preview"
            :active="preview.activeId.value === tab.id"
            @close="emit('hide')"
          />
          <MarkdownPreview
            v-else-if="tab.kind === 'markdown'"
            :file="tab.file"
            :session="preview"
            :active="preview.activeId.value === tab.id"
            @edit="emit('edit', tab.path)"
            @close="emit('hide')"
          />
          <PdfPreview
            v-else-if="tab.kind === 'pdf'"
            :file="tab.file"
            :session="preview"
            :active="preview.activeId.value === tab.id"
            @close="emit('hide')"
          />
          <SpreadsheetPreview
            v-else-if="tab.kind === 'spreadsheet'"
            :file="tab.file"
            :session="preview"
            :active="preview.activeId.value === tab.id"
            :rows-per-page="spreadsheetRowsPerPage"
            :max-columns="spreadsheetMaxColumns"
            @close="emit('hide')"
          />
          <DocxPreview
            v-else-if="tab.kind === 'docx'"
            :file="tab.file"
            :session="preview"
            :active="preview.activeId.value === tab.id"
            @close="emit('hide')"
          />
          <div v-else class="grid h-full place-items-center text-text-secondary">
            {{ t('fileManager.preview.unavailable') }}
          </div>
        </template>
      </div>
    </template>
    <div v-if="!preview.tabs.value.length" class="grid h-full place-items-center text-text-secondary">
      {{ t('fileManager.preview.openFiles') }}
    </div>
  </section>
</template>
