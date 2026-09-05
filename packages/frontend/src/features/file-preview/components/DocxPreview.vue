<script setup lang="ts">
  import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { renderAsync } from 'docx-preview';
  import PreviewSearchBar from './PreviewSearchBar.vue';
  import FilePreviewDialog from './FilePreviewDialog.vue';
  import PreviewHorizontalScrollbar from './PreviewHorizontalScrollbar.vue';
  import { useI18n } from 'vue-i18n';
  import type { FilePreviewSessionController } from '../composables/useFilePreviewTabs';
  import type { PreviewFile } from '../model/preview';
  import {
    activatePreviewSearchMatch,
    clearPreviewSearchMatches,
    highlightPreviewSearchMatches,
  } from './previewDomSearch';

  const { t } = useI18n();
  const props = withDefaults(
    defineProps<{ file: PreviewFile; session: FilePreviewSessionController; active?: boolean }>(),
    { active: true },
  );
  const emit = defineEmits<{ close: [] }>();
  const scroller = ref<HTMLElement | null>(null);
  const host = ref<HTMLElement | null>(null);
  const error = ref('');
  const rendering = ref(false);
  const rendered = ref(false);
  const searchOpen = ref(false);
  const searchQuery = ref('');
  const searchMatches = ref<HTMLElement[]>([]);
  const activeSearchIndex = ref(-1);
  let generation = 0;

  const focusSearchMatch = (behavior: ScrollBehavior = 'smooth') => {
    const active = activatePreviewSearchMatch(searchMatches.value, activeSearchIndex.value);
    active?.scrollIntoView({ block: 'center', inline: 'nearest', behavior });
  };
  const refreshSearch = (behavior: ScrollBehavior = 'auto') => {
    searchMatches.value = highlightPreviewSearchMatches(host.value, searchQuery.value);
    activeSearchIndex.value = searchMatches.value.length ? 0 : -1;
    if (activeSearchIndex.value >= 0) void nextTick(() => focusSearchMatch(behavior));
  };
  const moveSearch = (delta: number) => {
    if (!searchMatches.value.length) return;
    activeSearchIndex.value =
      (activeSearchIndex.value + delta + searchMatches.value.length) % searchMatches.value.length;
    focusSearchMatch();
  };
  const closeSearch = () => {
    searchOpen.value = false;
    searchQuery.value = '';
    searchMatches.value = [];
    activeSearchIndex.value = -1;
    clearPreviewSearchMatches(host.value);
  };
  const render = async () => {
    if (!props.active) return;
    const current = ++generation;
    error.value = '';
    rendering.value = true;
    await nextTick();
    host.value?.replaceChildren();
    try {
      await renderAsync(props.file.bytes.slice(0), host.value!, undefined, {
        inWrapper: true,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        useBase64URL: true,
      });
      if (current === generation) {
        rendered.value = true;
        if (searchQuery.value.trim()) refreshSearch();
      }
    } catch {
      if (current === generation) {
        rendered.value = false;
        error.value = t('fileManager.preview.docxLoadFailed');
      }
    } finally {
      if (current === generation) rendering.value = false;
    }
  };

  onMounted(() => {
    if (props.active) void render();
  });
  onBeforeUnmount(() => {
    generation += 1;
  });
  watch(
    () => props.file.bytes,
    () => {
      rendered.value = false;
      if (props.active) void render();
    },
  );
  watch(
    () => props.active,
    (active) => {
      if (active && !rendered.value && !rendering.value) void render();
    },
  );
  watch(searchQuery, () => refreshSearch());
</script>
<template>
  <FilePreviewDialog
    :file="file"
    :session="session"
    :subtitle="t('fileManager.preview.docx')"
    :active="active"
    @close="emit('close')"
  >
    <template #toolbar>
      <PreviewSearchBar
        :open="searchOpen"
        :query="searchQuery"
        :current="activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0"
        :total="searchMatches.length"
        :active="active"
        @open="searchOpen = true"
        @close="closeSearch"
        @update:query="searchQuery = $event"
        @previous="moveSearch(-1)"
        @next="moveSearch(1)"
      />
    </template>

    <div data-testid="docx-preview" class="flex h-full min-h-[18rem] flex-col overflow-hidden">
      <div
        ref="scroller"
        data-testid="docx-preview-scroller"
        role="region"
        :aria-label="t('fileManager.preview.docx')"
        class="docx-scroller relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-black/10 p-3 md:p-6"
      >
        <div
          v-if="rendering"
          class="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/80 text-sm text-text-secondary"
          aria-live="polite"
        >
          <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
          <span>{{ t('fileManager.preview.loading') }}</span>
        </div>
        <div
          v-if="error"
          class="mx-auto max-w-xl rounded-md border border-error/40 bg-error/10 p-4 text-sm text-error"
          role="alert"
        >
          {{ error }}
        </div>
        <div ref="host" class="docx-preview-host"></div>
      </div>
      <PreviewHorizontalScrollbar
        :target="scroller"
        test-id="docx-horizontal-scrollbar"
        :active="active"
        :label="t('fileManager.preview.horizontalScroll')"
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
    box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
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
  .docx-scroller {
    touch-action: pan-x pan-y;
    -webkit-overflow-scrolling: touch;
  }
  @media (max-width: 767px), (pointer: coarse) {
    .docx-scroller {
      scrollbar-width: none;
    }
    .docx-scroller::-webkit-scrollbar {
      display: none;
    }
  }
</style>
