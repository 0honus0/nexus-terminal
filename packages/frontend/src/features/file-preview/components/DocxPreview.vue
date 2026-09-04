<script setup lang="ts">
  import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { renderAsync } from 'docx-preview';
  import { BaseSpinner } from '@/foundation/ui';
  import PreviewSearchBar from './PreviewSearchBar.vue';
  import PreviewHorizontalScrollbar from './PreviewHorizontalScrollbar.vue';
  import { useI18n } from 'vue-i18n';
  import {
    activatePreviewSearchMatch,
    clearPreviewSearchMatches,
    highlightPreviewSearchMatches,
  } from './previewDomSearch';

  const { t } = useI18n();
  const props = withDefaults(defineProps<{ bytes: ArrayBuffer; active?: boolean }>(), { active: true });
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
      await renderAsync(props.bytes.slice(0), host.value!, undefined, {
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
    () => props.bytes,
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
  <div class="flex h-full min-h-0 flex-col bg-white text-black">
    <div class="flex items-center gap-1 border-b border-gray-300 bg-white p-2">
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
    </div>
    <div ref="scroller" class="docx-scroller min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4">
      <div v-if="rendering" class="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
        <BaseSpinner />
        <span>{{ t('fileManager.preview.loading') }}</span>
      </div>
      <p v-if="error" class="text-error">{{ error }}</p>
      <div ref="host" class="docx-preview-host"></div>
    </div>
    <PreviewHorizontalScrollbar
      :target="scroller"
      :active="active"
      :label="t('fileManager.preview.horizontalScroll')"
    />
  </div>
</template>

<style scoped>
  .docx-preview-host :deep(.docx-wrapper) {
    background: transparent;
    padding: 0;
  }
  .docx-preview-host :deep(section.docx) {
    margin: 0 auto 1rem;
    overflow: visible;
  }
  .docx-preview-host :deep(mark[data-preview-search-match]) {
    background: #fff3a3;
  }
  .docx-preview-host :deep(mark[data-preview-search-active]) {
    outline: 2px solid currentColor;
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
