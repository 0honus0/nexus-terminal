<script setup lang="ts">
  import { nextTick, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { renderAsync } from 'docx-preview';
  import type { FileListItem } from '../../types/sftp.types';
  import FilePreviewDialog from './FilePreviewDialog.vue';
  import PreviewSearchBar from './PreviewSearchBar.vue';
  import PreviewHorizontalScrollbar from './PreviewHorizontalScrollbar.vue';
  import {
    activatePreviewSearchMatch,
    clearPreviewSearchMatches,
    highlightPreviewSearchMatches,
  } from './previewDomSearch';

  const props = withDefaults(
    defineProps<{
      file: FileListItem;
      buffer: ArrayBuffer;
      active?: boolean;
    }>(),
    {
      active: true,
    },
  );

  const emit = defineEmits<{
    close: [];
  }>();

  const { t } = useI18n();
  const scrollerRef = ref<HTMLElement | null>(null);
  const containerRef = ref<HTMLElement | null>(null);
  const isRendering = ref(true);
  const renderError = ref('');
  const searchOpen = ref(false);
  const searchQuery = ref('');
  const searchMatches = ref<HTMLElement[]>([]);
  const activeSearchIndex = ref(-1);
  let rendered = false;
  let renderToken = 0;

  const focusSearchMatch = (behavior: ScrollBehavior = 'smooth') => {
    const activeMatch = activatePreviewSearchMatch(searchMatches.value, activeSearchIndex.value);
    activeMatch?.scrollIntoView({ block: 'center', inline: 'nearest', behavior });
  };

  const refreshSearch = (behavior: ScrollBehavior = 'auto') => {
    searchMatches.value = highlightPreviewSearchMatches(containerRef.value, searchQuery.value);
    activeSearchIndex.value = searchMatches.value.length > 0 ? 0 : -1;
    if (activeSearchIndex.value >= 0) void nextTick(() => focusSearchMatch(behavior));
  };

  const updateSearchQuery = (value: string) => {
    searchQuery.value = value;
    refreshSearch();
  };

  const openSearch = () => {
    searchOpen.value = true;
  };

  const closeSearch = () => {
    searchOpen.value = false;
    searchQuery.value = '';
    activeSearchIndex.value = -1;
    searchMatches.value = [];
    clearPreviewSearchMatches(containerRef.value);
  };

  const nextSearchMatch = () => {
    if (searchMatches.value.length === 0) return;
    activeSearchIndex.value = (activeSearchIndex.value + 1) % searchMatches.value.length;
    focusSearchMatch();
  };

  const previousSearchMatch = () => {
    if (searchMatches.value.length === 0) return;
    activeSearchIndex.value = (activeSearchIndex.value - 1 + searchMatches.value.length) % searchMatches.value.length;
    focusSearchMatch();
  };

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
      if (token === renderToken && searchQuery.value.trim()) refreshSearch();
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

  watch(
    () => props.active,
    (active) => {
      if (active && !rendered) void nextTick(renderDocument);
    },
  );

  watch(
    () => props.buffer,
    () => {
      renderToken += 1;
      rendered = false;
      renderError.value = '';
      searchMatches.value = [];
      activeSearchIndex.value = -1;
      clearPreviewSearchMatches(containerRef.value);
      if (containerRef.value) containerRef.value.replaceChildren();
      if (props.active) void nextTick(renderDocument);
    },
  );
</script>

<template>
  <FilePreviewDialog
    :file="props.file"
    :subtitle="t('fileManager.preview.docx', 'Word document')"
    :active="props.active"
    @close="emit('close')"
  >
    <template #toolbar>
      <PreviewSearchBar
        :open="searchOpen"
        :query="searchQuery"
        :current="activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0"
        :total="searchMatches.length"
        :active="props.active"
        @open="openSearch"
        @close="closeSearch"
        @update:query="updateSearchQuery"
        @previous="previousSearchMatch"
        @next="nextSearchMatch"
      />
    </template>

    <div class="flex h-full min-h-[18rem] flex-col overflow-hidden" data-testid="docx-preview">
      <div
        ref="scrollerRef"
        data-testid="docx-preview-scroller"
        class="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-black/10 p-3 md:p-6"
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

  .docx-preview-host :deep(section.docx) {
    overflow: visible;
  }

  .docx-preview-host :deep(mark[data-preview-search-match]) {
    border-radius: 2px;
    background: color-mix(in srgb, var(--color-warning) 55%, transparent);
    color: inherit;
    padding: 0;
  }

  .docx-preview-host :deep(mark[data-preview-search-active]) {
    background: color-mix(in srgb, var(--color-primary) 52%, transparent);
    outline: 1px solid color-mix(in srgb, var(--color-primary) 80%, transparent);
  }
</style>
