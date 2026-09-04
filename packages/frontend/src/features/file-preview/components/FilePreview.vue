<script setup lang="ts">
  import { defineAsyncComponent, nextTick, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseSpinner } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
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
  const feedback = useFeedback();
  const preview = props.session ?? createFilePreviewSession(props.source);
  const tabList = ref<HTMLElement | null>(null);
  const scrollActiveTabIntoView = (): void => {
    const activeId = preview.activeId.value;
    if (!activeId || !tabList.value) return;
    const activeTab = Array.from(tabList.value.querySelectorAll<HTMLElement>('[data-preview-tab-id]')).find(
      (element) => element.dataset.previewTabId === activeId,
    );
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };
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
  const refresh = async (): Promise<void> => {
    try {
      await preview.refresh();
    } catch {
      feedback.notifyError(t('fileManager.preview.refreshFailed'));
    }
  };
  watch(
    () => preview.activeId.value,
    () => void nextTick(scrollActiveTabIntoView),
  );
  defineExpose({ open, close: preview.close, clear: preview.clear, refresh: preview.refresh });
</script>

<template>
  <section data-testid="file-preview-view" class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex min-w-0 items-center border-b border-border bg-header/40">
      <div
        ref="tabList"
        data-testid="file-preview-tabs"
        class="flex min-w-0 flex-1 snap-x overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]"
        role="tablist"
      >
        <div
          v-for="tab in preview.tabs.value"
          :key="tab.id"
          :data-preview-tab-id="tab.id"
          class="flex min-h-11 max-w-56 shrink-0 snap-start items-center border-r border-border text-sm sm:min-h-0"
          :class="preview.activeId.value === tab.id ? 'bg-background' : 'text-text-secondary'"
        >
          <button
            type="button"
            role="tab"
            class="min-w-0 flex-1 px-3 py-2 text-left"
            :aria-selected="preview.activeId.value === tab.id"
            :title="tab.path"
            @click="preview.activeId.value = tab.id"
          >
            <span class="block truncate">{{ tab.name }}</span>
          </button>
          <button
            type="button"
            class="grid min-h-11 min-w-11 place-items-center rounded hover:bg-border sm:min-h-6 sm:min-w-6"
            :aria-label="t('fileManager.preview.closeFile', { file: tab.name })"
            @click="preview.close(tab.id)"
          >
            ×
          </button>
        </div>
      </div>
      <div v-if="preview.active.value" class="flex shrink-0 gap-1 px-1">
        <BaseButton
          v-if="preview.active.value.kind === 'markdown'"
          class="min-h-11 sm:min-h-0"
          size="sm"
          variant="ghost"
          @click="emit('edit', preview.active.value.path)"
          >{{ t('common.edit') }}</BaseButton
        >
        <BaseButton
          class="min-h-11 sm:min-h-0"
          size="sm"
          variant="ghost"
          :disabled="preview.active.value.refreshing"
          @click="refresh"
          >{{ t('fileManager.preview.refresh') }}</BaseButton
        >
        <BaseButton
          class="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
          size="sm"
          variant="ghost"
          :title="t('fileManager.preview.close')"
          @click="emit('hide')"
          >×</BaseButton
        >
      </div>
    </div>

    <div class="relative min-h-0 flex-1">
      <template v-for="tab in preview.tabs.value" :key="tab.id">
        <div v-show="preview.activeId.value === tab.id" class="absolute inset-0 min-h-0">
          <BaseSpinner v-if="tab.loading" class="m-6" />
          <p v-else-if="tab.error" class="p-4 text-error">{{ previewError(tab) }}</p>
          <template v-else-if="tab.file">
            <ImagePreview v-if="tab.kind === 'image'" v-bind="tab.file" />
            <MarkdownPreview v-else-if="tab.kind === 'markdown'" :bytes="tab.file.bytes" />
            <PdfPreview
              v-else-if="tab.kind === 'pdf'"
              :bytes="tab.file.bytes"
              :active="preview.activeId.value === tab.id"
            />
            <SpreadsheetPreview
              v-else-if="tab.kind === 'spreadsheet'"
              :bytes="tab.file.bytes"
              :active="preview.activeId.value === tab.id"
              :rows-per-page="spreadsheetRowsPerPage"
              :max-columns="spreadsheetMaxColumns"
            />
            <DocxPreview
              v-else-if="tab.kind === 'docx'"
              :bytes="tab.file.bytes"
              :active="preview.activeId.value === tab.id"
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
    </div>
  </section>
</template>
