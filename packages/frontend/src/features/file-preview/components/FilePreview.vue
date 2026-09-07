<script setup lang="ts">
  import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseSpinner } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import ImagePreview from './ImagePreview.vue';
  import FilePreviewDialog from './FilePreviewDialog.vue';

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
  const emit = defineEmits<{ edit: [path: string]; hide: []; dismiss: [] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const preview = props.session ?? createFilePreviewSession(props.source);
  const root = ref<HTMLElement | null>(null);
  const loadingTab = computed(() => (preview.active.value?.loading ? preview.active.value : null));

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
  const retry = async (tab: (typeof preview.tabs.value)[number]): Promise<void> => {
    try {
      await preview.refresh(tab);
    } catch {
      feedback.notifyError(t('fileManager.preview.refreshFailed'));
    }
  };
  const cancelLoading = (closeWorkspace: boolean): void => {
    const tab = loadingTab.value;
    if (!tab) return;
    preview.close(tab.id);
    if (closeWorkspace) emit('hide');
    else emit('dismiss');
  };
  const handleLoadingKeydown = (event: KeyboardEvent): void => {
    if (!loadingTab.value || !root.value?.getClientRects().length || event.defaultPrevented || event.key !== 'Escape')
      return;
    event.preventDefault();
    cancelLoading(false);
  };

  onMounted(() => document.addEventListener('keydown', handleLoadingKeydown));
  onBeforeUnmount(() => document.removeEventListener('keydown', handleLoadingKeydown));

  defineExpose({ open, close: preview.close, clear: preview.clear, refresh: preview.refresh });
</script>

<template>
  <section ref="root" data-testid="file-preview-view" class="relative flex h-full min-h-0 flex-col bg-background">
    <template v-for="tab in preview.tabs.value" :key="tab.id">
      <div v-show="preview.activeId.value === tab.id" class="absolute inset-0 min-h-0">
        <BaseSpinner v-if="tab.loading" class="m-6" />
        <FilePreviewDialog
          v-else-if="tab.error"
          :file="{ name: tab.name, path: tab.path }"
          :session="preview"
          :active="preview.activeId.value === tab.id"
          @close="emit('hide')"
        >
          <div class="flex h-full min-h-[18rem] items-center justify-center p-6">
            <div
              data-testid="file-preview-error"
              class="flex max-w-xl flex-col items-center gap-4 rounded-md border border-error/40 bg-error/10 p-5 text-center text-sm text-error"
              role="alert"
            >
              <i class="fas fa-triangle-exclamation text-lg" aria-hidden="true"></i>
              <div class="space-y-1">
                <p>{{ t('fileManager.preview.loadFailed') }}</p>
                <p class="break-words text-xs opacity-80">{{ previewError(tab) }}</p>
              </div>
              <button
                type="button"
                data-testid="file-preview-retry"
                class="inline-flex min-h-11 items-center gap-2 rounded-md border border-error/50 px-3 py-2 text-sm hover:bg-error/10 focus:outline-none focus:ring-1 focus:ring-error disabled:cursor-wait disabled:opacity-60"
                :disabled="tab.refreshing"
                :aria-busy="tab.refreshing"
                @click="retry(tab)"
              >
                <i class="fas fa-rotate" :class="tab.refreshing ? 'fa-spin' : ''" aria-hidden="true"></i>
                <span>{{ t('common.retry') }}</span>
              </button>
            </div>
          </div>
        </FilePreviewDialog>
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
    <div
      v-if="loadingTab"
      data-testid="file-preview-loading"
      class="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      :aria-label="t('fileManager.preview.loading')"
      @click.self="cancelLoading(false)"
    >
      <div
        class="flex items-center gap-3 rounded-md border border-white/20 bg-[#141414] px-4 py-3 text-white shadow-xl"
      >
        <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
        <span>{{ t('fileManager.preview.loading') }}</span>
        <button
          type="button"
          class="ml-1 flex h-11 w-11 items-center justify-center text-2xl leading-none hover:text-white/70 focus:outline-none focus:ring-1 focus:ring-white/70"
          :aria-label="t('fileManager.preview.close')"
          :title="t('fileManager.preview.close')"
          @click="cancelLoading(true)"
        >
          ×
        </button>
      </div>
    </div>
    <div v-if="!preview.tabs.value.length" class="grid h-full place-items-center text-text-secondary">
      {{ t('fileManager.preview.openFiles') }}
    </div>
  </section>
</template>
