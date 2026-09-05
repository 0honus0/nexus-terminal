<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';
  import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
  import FilePreviewDialog from './FilePreviewDialog.vue';
  import PreviewSearchBar from './PreviewSearchBar.vue';
  import PreviewHorizontalScrollbar from './PreviewHorizontalScrollbar.vue';
  import PdfOutlineItems from './PdfOutlineItems.vue';
  import PdfPage from './PdfPage.vue';
  import type { FilePreviewSessionController } from '../composables/useFilePreviewTabs';
  import type { PreviewFile } from '../model/preview';
  import type { PdfOutlineItem, PdfSearchMatch } from '../model/pdf';

  GlobalWorkerOptions.workerSrc = workerUrl;

  const props = withDefaults(
    defineProps<{ file: PreviewFile; session: FilePreviewSessionController; active?: boolean }>(),
    { active: true },
  );
  const emit = defineEmits<{ close: [] }>();
  const { t } = useI18n();
  const root = ref<HTMLElement | null>(null);
  const scroller = ref<HTMLElement | null>(null);
  const document = shallowRef<PDFDocumentProxy | null>(null);
  const outline = ref<PdfOutlineItem[]>([]);
  const loading = ref(true);
  const error = ref('');
  const currentPage = ref(1);
  const zoomPercent = ref(100);
  const fitWidth = ref(true);
  const availablePageWidth = ref(220);
  const pageScalePercents = ref<Record<number, number>>({});
  const outlineOpen = ref(false);
  const desktopOutlineVisible = ref(true);
  const desktop = ref(window.matchMedia('(min-width: 640px)').matches);
  const searchOpen = ref(false);
  const searchQuery = ref('');
  const searchAppliedQuery = ref('');
  const searchMatches = ref<PdfSearchMatch[]>([]);
  const activeSearchIndex = ref(-1);
  const searchBusy = ref(false);
  const pinchScale = ref(1);
  const pinchPreviewPercent = ref<number | null>(null);
  let loadingTask: PDFDocumentLoadingTask | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let desktopQuery: MediaQueryList | null = null;
  const syncDesktop = (): void => {
    const wasDesktop = desktop.value;
    desktop.value = desktopQuery?.matches ?? false;
    if (desktop.value) {
      outlineOpen.value = false;
      if (!wasDesktop) desktopOutlineVisible.value = true;
    }
    void nextTick(() => {
      if (updateAvailableWidth() && props.active) scrollToPage(currentPage.value, 'auto');
    });
  };
  let scrollFrame = 0;
  let documentGeneration = 0;
  let searchGeneration = 0;
  let searchIndexDocument: PDFDocumentProxy | null = null;
  let searchIndexPromise: Promise<void> | null = null;
  let searchPageTextItems: string[][] = [];
  let restoreFrame = 0;
  let restoreTimer = 0;
  let restoringScroll = false;
  let savedScrollTop = 0;
  let savedScrollLeft = 0;
  let savedCurrentPage = 1;
  let savedNeedsPageAnchor = false;
  let pendingPageJump: { page: number; behavior: ScrollBehavior } | null = null;
  let pinchGesture: { startDistance: number; startZoom: number; targetZoom: number } | null = null;

  const pageCount = computed(() => document.value?.numPages ?? 0);
  const outlineVisible = computed(() => (desktop.value ? desktopOutlineVisible.value : outlineOpen.value));
  const currentFitZoom = computed(
    () => pageScalePercents.value[currentPage.value] ?? pageScalePercents.value[1] ?? 100,
  );
  const displayedZoomPercent = computed(
    () => pinchPreviewPercent.value ?? (fitWidth.value ? currentFitZoom.value : zoomPercent.value),
  );
  const activeSearchMatch = computed(() => searchMatches.value[activeSearchIndex.value] ?? null);
  const subtitle = computed(() => t('fileManager.preview.pdfMeta', { pages: pageCount.value }));

  const mapOutline = (items: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>): PdfOutlineItem[] =>
    items.map((item) => ({
      title: item.title,
      dest: item.dest,
      url: item.url,
      items: mapOutline(item.items),
    }));

  const updateAvailableWidth = (): boolean => {
    const element = scroller.value;
    if (!element || !props.active || element.clientWidth < 32) return false;
    const style = getComputedStyle(element);
    const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    const nextWidth = Math.max(220, element.clientWidth - padding);
    if (Math.abs(nextWidth - availablePageWidth.value) < 1) return false;
    availablePageWidth.value = nextWidth;
    return true;
  };

  const destroyDocument = async (): Promise<void> => {
    documentGeneration += 1;
    searchGeneration += 1;
    pendingPageJump = null;
    searchIndexDocument = null;
    searchIndexPromise = null;
    searchPageTextItems = [];
    const task = loadingTask;
    loadingTask = null;
    document.value = null;
    if (task) await task.destroy().catch(() => undefined);
  };

  const loadDocument = async (): Promise<void> => {
    await destroyDocument();
    const generation = ++documentGeneration;
    loading.value = true;
    error.value = '';
    outline.value = [];
    pageScalePercents.value = {};

    const task = getDocument({ data: new Uint8Array(props.file.bytes.slice(0)) });
    loadingTask = task;
    try {
      const nextDocument = await task.promise;
      if (generation !== documentGeneration) {
        await task.destroy();
        return;
      }
      document.value = nextDocument;
      currentPage.value = Math.min(Math.max(currentPage.value, 1), Math.max(1, nextDocument.numPages));
      outline.value = mapOutline((await nextDocument.getOutline()) ?? []);
      loading.value = false;
      await nextTick();
      updateAvailableWidth();
      scrollToPage(currentPage.value, 'auto');
      if (searchQuery.value.trim()) void runSearch(searchQuery.value);
    } catch (cause) {
      if (generation === documentGeneration) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        loading.value = false;
      }
    }
  };

  const pageElement = (page: number): HTMLElement | null =>
    scroller.value?.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`) ?? null;

  const hasMeasuredPagesThrough = (page: number): boolean => {
    for (let index = 1; index <= page; index += 1) {
      if (!Number.isFinite(pageScalePercents.value[index])) return false;
    }
    return true;
  };

  const applyPageScroll = (page: number, behavior: ScrollBehavior): boolean => {
    const container = scroller.value;
    const target = pageElement(page);
    if (!container || !target) return false;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (targetRect.height < 32) return false;
    restoringScroll = true;
    container.scrollTo({
      top: Math.max(0, container.scrollTop + targetRect.top - containerRect.top - 8),
      left: 0,
      behavior,
    });
    if (restoreFrame) cancelAnimationFrame(restoreFrame);
    if (restoreTimer) window.clearTimeout(restoreTimer);
    if (behavior === 'smooth') {
      restoreTimer = window.setTimeout(() => {
        restoreTimer = 0;
        restoringScroll = false;
        queueCurrentPageUpdate();
      }, 450);
    } else {
      restoreFrame = requestAnimationFrame(() => {
        restoreFrame = 0;
        restoringScroll = false;
        queueCurrentPageUpdate();
      });
    }
    return true;
  };

  const finishPendingPageJump = (): boolean => {
    const pending = pendingPageJump;
    if (!pending || !props.active || !hasMeasuredPagesThrough(pending.page)) return false;
    if (!applyPageScroll(pending.page, pending.behavior)) return false;
    pendingPageJump = null;
    savedNeedsPageAnchor = false;
    return true;
  };

  const scrollToPage = (page: number, behavior: ScrollBehavior = 'auto'): void => {
    const targetPage = Math.min(Math.max(Math.round(page), 1), Math.max(1, pageCount.value));
    currentPage.value = targetPage;
    pendingPageJump = { page: targetPage, behavior };
    if (!desktop.value) outlineOpen.value = false;
    void nextTick(finishPendingPageJump);
  };

  const updateCurrentPage = (): void => {
    scrollFrame = 0;
    const container = scroller.value;
    if (!container || !props.active || restoringScroll || pendingPageJump) return;
    const containerRect = container.getBoundingClientRect();
    const focusY = containerRect.top + Math.min(container.clientHeight * 0.35, 260);
    const pages = [...container.querySelectorAll<HTMLElement>('[data-pdf-page]')];
    let bestPage = currentPage.value;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const page of pages) {
      const rect = page.getBoundingClientRect();
      if (rect.height < 32) continue;
      if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) continue;
      const distance = focusY < rect.top ? rect.top - focusY : focusY > rect.bottom ? focusY - rect.bottom : 0;
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      bestPage = Number(page.dataset.pdfPage) || bestPage;
      if (distance === 0) break;
    }
    currentPage.value = bestPage;
  };

  const queueCurrentPageUpdate = (): void => {
    if (scrollFrame || !props.active || restoringScroll || pendingPageJump) return;
    scrollFrame = requestAnimationFrame(updateCurrentPage);
  };

  const handlePageInput = (event: Event): void => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) scrollToPage(value);
  };

  const setZoom = (percent: number): void => {
    const anchorPage = currentPage.value;
    zoomPercent.value = Math.min(400, Math.max(25, Math.round(percent)));
    fitWidth.value = false;
    void nextTick(() => requestAnimationFrame(() => scrollToPage(anchorPage, 'auto')));
  };

  const setFitWidth = (): void => {
    const anchorPage = currentPage.value;
    fitWidth.value = true;
    void nextTick(() => requestAnimationFrame(() => scrollToPage(anchorPage, 'auto')));
  };

  const handlePageScale = (page: number, percent: number): void => {
    pageScalePercents.value = { ...pageScalePercents.value, [page]: percent };
    if (pendingPageJump) {
      void nextTick(() =>
        requestAnimationFrame(() => {
          if (!finishPendingPageJump()) return;
          queueCurrentPageUpdate();
        }),
      );
      return;
    }
    queueCurrentPageUpdate();
  };

  const ensureSearchIndex = async (): Promise<void> => {
    const targetDocument = document.value;
    if (!targetDocument) return;
    if (searchIndexDocument === targetDocument && searchPageTextItems.length === targetDocument.numPages) return;
    if (searchIndexPromise && searchIndexDocument === targetDocument) return searchIndexPromise;

    searchIndexDocument = targetDocument;
    searchPageTextItems = Array.from({ length: targetDocument.numPages }, () => []);
    searchIndexPromise = (async () => {
      let pageIndex = 0;
      const workers = Math.min(4, targetDocument.numPages);
      await Promise.all(
        Array.from({ length: workers }, async () => {
          while (pageIndex < targetDocument.numPages) {
            const index = pageIndex;
            pageIndex += 1;
            const page = await targetDocument.getPage(index + 1);
            const content = await page.getTextContent();
            searchPageTextItems[index] = content.items.flatMap((item) =>
              'str' in item && typeof item.str === 'string' ? [item.str] : [],
            );
            page.cleanup();
          }
        }),
      );
    })();
    try {
      await searchIndexPromise;
    } finally {
      if (searchIndexDocument === targetDocument) searchIndexPromise = null;
    }
  };

  const runSearch = async (value: string): Promise<void> => {
    const query = value.trim().toLocaleLowerCase();
    const generation = ++searchGeneration;
    if (!query) {
      searchAppliedQuery.value = '';
      searchMatches.value = [];
      activeSearchIndex.value = -1;
      searchBusy.value = false;
      return;
    }

    searchBusy.value = true;
    await ensureSearchIndex();
    if (generation !== searchGeneration) return;

    const matches: PdfSearchMatch[] = [];
    searchPageTextItems.forEach((items, pageIndex) => {
      let occurrence = 0;
      for (const item of items) {
        const lower = item.toLocaleLowerCase();
        let offset = 0;
        let index = lower.indexOf(query, offset);
        while (index >= 0) {
          matches.push({ page: pageIndex + 1, occurrence });
          occurrence += 1;
          offset = index + query.length;
          index = lower.indexOf(query, offset);
        }
      }
    });
    searchAppliedQuery.value = value.trim();
    searchMatches.value = matches;
    activeSearchIndex.value = matches.length ? 0 : -1;
    searchBusy.value = false;
    if (matches[0]) scrollToPage(matches[0].page, 'auto');
  };

  const moveSearch = (delta: number): void => {
    if (!searchMatches.value.length) return;
    activeSearchIndex.value =
      (activeSearchIndex.value + delta + searchMatches.value.length) % searchMatches.value.length;
    scrollToPage(searchMatches.value[activeSearchIndex.value]!.page, 'smooth');
  };

  const resolveOutlineDestination = async (item: PdfOutlineItem): Promise<void> => {
    const targetDocument = document.value;
    if (!targetDocument || !item.dest) return;
    let destination: unknown = item.dest;
    if (typeof destination === 'string') destination = await targetDocument.getDestination(destination);
    if (!Array.isArray(destination) || !destination.length) return;
    const target = destination[0];
    if (typeof target === 'number') {
      scrollToPage(target + 1);
      return;
    }
    if (target && typeof target === 'object') {
      const index = await targetDocument.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
      scrollToPage(index + 1);
    }
  };

  const touchDistance = (first: Touch, second: Touch): number =>
    Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);

  const handleTouchStart = (event: TouchEvent): void => {
    if (event.touches.length !== 2) {
      pinchGesture = null;
      return;
    }
    const distance = touchDistance(event.touches[0]!, event.touches[1]!);
    if (distance <= 0) return;
    const startZoom = displayedZoomPercent.value;
    pinchGesture = { startDistance: distance, startZoom, targetZoom: startZoom };
  };

  const handleTouchMove = (event: TouchEvent): void => {
    if (!pinchGesture || event.touches.length !== 2) return;
    const distance = touchDistance(event.touches[0]!, event.touches[1]!);
    if (distance <= 0) return;
    event.preventDefault();
    const targetZoom = Math.min(400, Math.max(25, pinchGesture.startZoom * (distance / pinchGesture.startDistance)));
    pinchGesture.targetZoom = targetZoom;
    pinchPreviewPercent.value = targetZoom;
    pinchScale.value = targetZoom / pinchGesture.startZoom;
  };

  const commitPinch = (): void => {
    if (!pinchGesture) return;
    const anchorPage = currentPage.value;
    const targetZoom = pinchGesture.targetZoom;
    const changed = Math.abs(targetZoom - pinchGesture.startZoom) >= 2;
    pinchGesture = null;
    pinchPreviewPercent.value = null;
    if (!changed) {
      pinchScale.value = 1;
      return;
    }
    fitWidth.value = false;
    zoomPercent.value = Math.round(targetZoom);
    void nextTick(() =>
      requestAnimationFrame(() => {
        pinchScale.value = 1;
        scrollToPage(anchorPage, 'auto');
      }),
    );
  };

  const handleTouchEnd = (event: TouchEvent): void => {
    if (event.touches.length < 2) commitPinch();
  };

  const openSearch = (): void => {
    searchOpen.value = true;
  };
  const closeSearch = (): void => {
    searchOpen.value = false;
    searchGeneration += 1;
    searchBusy.value = false;
    searchQuery.value = '';
    searchAppliedQuery.value = '';
    searchMatches.value = [];
    activeSearchIndex.value = -1;
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input,button,select,textarea')) return;
    if (event.key === 'PageUp') {
      event.preventDefault();
      scrollToPage(currentPage.value - 1);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      scrollToPage(currentPage.value + 1);
    }
  };

  watch(() => props.file.bytes, loadDocument);
  watch(searchQuery, (value) => void runSearch(value));
  watch(
    () => props.active,
    (active) => {
      const container = scroller.value;
      if (!container) return;
      if (!active) {
        if (scrollFrame) {
          cancelAnimationFrame(scrollFrame);
          scrollFrame = 0;
        }
        savedScrollTop = container.scrollTop;
        savedScrollLeft = container.scrollLeft;
        savedCurrentPage = currentPage.value;
        savedNeedsPageAnchor = Boolean(pendingPageJump);
        restoringScroll = false;
        if (restoreFrame) cancelAnimationFrame(restoreFrame);
        restoreFrame = 0;
        if (restoreTimer) window.clearTimeout(restoreTimer);
        restoreTimer = 0;
        outlineOpen.value = false;
        pinchGesture = null;
        pinchPreviewPercent.value = null;
        pinchScale.value = 1;
        return;
      }
      restoringScroll = true;
      currentPage.value = Math.min(Math.max(savedCurrentPage, 1), Math.max(1, pageCount.value));
      void nextTick(() => {
        restoreFrame = requestAnimationFrame(() => {
          restoreFrame = 0;
          if (updateAvailableWidth()) savedNeedsPageAnchor = true;
          if (savedNeedsPageAnchor) {
            restoringScroll = false;
            scrollToPage(savedCurrentPage, 'auto');
            return;
          }
          container.scrollTo({ top: savedScrollTop, left: savedScrollLeft, behavior: 'auto' });
          restoreFrame = requestAnimationFrame(() => {
            restoreFrame = 0;
            currentPage.value = Math.min(Math.max(savedCurrentPage, 1), Math.max(1, pageCount.value));
            restoringScroll = false;
            queueCurrentPageUpdate();
          });
        });
      });
    },
  );

  onMounted(() => {
    desktopQuery = window.matchMedia('(min-width: 640px)');
    desktopQuery.addEventListener('change', syncDesktop);
    resizeObserver = new ResizeObserver(() => {
      if (!props.active) return;
      const anchorPage = currentPage.value;
      if (updateAvailableWidth()) scrollToPage(anchorPage, 'auto');
    });
    if (scroller.value) resizeObserver.observe(scroller.value);
    void loadDocument();
  });

  onBeforeUnmount(() => {
    desktopQuery?.removeEventListener('change', syncDesktop);
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    if (restoreFrame) cancelAnimationFrame(restoreFrame);
    if (restoreTimer) window.clearTimeout(restoreTimer);
    resizeObserver?.disconnect();
    void destroyDocument();
  });
</script>

<template>
  <FilePreviewDialog :file="file" :session="session" :subtitle="subtitle" :active="active" @close="emit('close')">
    <template #toolbar>
      <div class="pdf-toolbar flex items-center gap-1">
        <PreviewSearchBar
          :open="searchOpen"
          :query="searchQuery"
          :current="activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0"
          :total="searchMatches.length"
          :active="active"
          :busy="searchBusy"
          @open="openSearch"
          @close="closeSearch"
          @update:query="searchQuery = $event"
          @previous="moveSearch(-1)"
          @next="moveSearch(1)"
        />
        <span class="pdf-toolbar-divider mx-1 h-5 w-px bg-border"></span>
        <button
          type="button"
          data-testid="pdf-previous-page"
          class="pdf-toolbar-button"
          :disabled="currentPage <= 1"
          :aria-label="t('fileManager.preview.pdfPreviousPage')"
          @click="scrollToPage(currentPage - 1)"
        >
          ‹
        </button>
        <input
          data-testid="pdf-current-page"
          class="pdf-page-input h-8 w-14 rounded border border-border bg-background px-1 text-center text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          type="number"
          min="1"
          :max="pageCount"
          :value="currentPage"
          :aria-label="t('fileManager.preview.pdfCurrentPage')"
          @change="handlePageInput"
        />
        <span class="text-xs text-text-secondary"
          >/ <span data-testid="pdf-page-count">{{ pageCount }}</span></span
        >
        <button
          type="button"
          data-testid="pdf-next-page"
          class="pdf-toolbar-button"
          :disabled="currentPage >= pageCount"
          :aria-label="t('fileManager.preview.pdfNextPage')"
          @click="scrollToPage(currentPage + 1)"
        >
          ›
        </button>
        <span class="pdf-toolbar-divider mx-1 h-5 w-px bg-border"></span>
        <button
          type="button"
          data-testid="pdf-zoom-out"
          class="pdf-toolbar-button"
          :aria-label="t('fileManager.preview.pdfZoomOut')"
          @click="setZoom(displayedZoomPercent - 25)"
        >
          −
        </button>
        <span data-testid="pdf-zoom-label" class="w-12 text-center text-xs text-text-secondary">
          {{ Math.round(displayedZoomPercent) }}%
        </span>
        <button
          type="button"
          data-testid="pdf-zoom-in"
          class="pdf-toolbar-button"
          :aria-label="t('fileManager.preview.pdfZoomIn')"
          @click="setZoom(displayedZoomPercent + 25)"
        >
          +
        </button>
        <button
          type="button"
          data-testid="pdf-fit-width"
          class="pdf-fit-width ml-1 h-8 rounded-md border border-border px-2 text-xs text-text-secondary hover:bg-border hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          :class="fitWidth ? 'bg-primary/10 text-primary' : ''"
          :aria-pressed="fitWidth"
          @click="setFitWidth"
        >
          {{ t('fileManager.preview.pdfFitWidth') }}
        </button>
        <button
          type="button"
          data-testid="pdf-outline-toggle"
          class="pdf-toolbar-button"
          :class="{ 'pdf-toolbar-button-active': outlineVisible }"
          :aria-expanded="outlineVisible"
          :aria-pressed="outlineVisible"
          :aria-label="t('fileManager.preview.pdfOutline')"
          :title="t('fileManager.preview.pdfOutline')"
          @click="desktop ? (desktopOutlineVisible = !desktopOutlineVisible) : (outlineOpen = !outlineOpen)"
        >
          <i class="fas fa-list-ul" aria-hidden="true"></i>
        </button>
      </div>
    </template>

    <div
      ref="root"
      data-testid="pdf-preview"
      class="pdf-preview-root relative flex h-full min-h-0 w-full overflow-hidden outline-none"
      tabindex="0"
      @keydown="handleKeydown"
    >
      <button
        v-if="outlineOpen && !desktop"
        type="button"
        class="absolute inset-0 z-10 bg-black/35"
        :aria-label="t('common.close')"
        @click="outlineOpen = false"
      ></button>
      <aside
        data-testid="pdf-outline-drawer"
        :aria-label="t('fileManager.preview.pdfOutline')"
        class="pdf-outline-drawer absolute inset-y-0 left-0 z-20 flex w-[min(82vw,18rem)] flex-col border-r border-border bg-header/95 shadow-xl sm:relative sm:inset-auto sm:z-auto sm:w-52 sm:shrink-0 sm:translate-x-0 sm:pointer-events-auto sm:shadow-none"
        :class="outlineOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'"
        :style="desktop && !desktopOutlineVisible ? { display: 'none' } : undefined"
        :aria-hidden="desktop ? !desktopOutlineVisible : !outlineOpen"
      >
        <header class="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          <strong class="truncate text-sm font-medium">{{ t('fileManager.preview.pdfOutline') }}</strong>
          <button
            v-if="!desktop"
            type="button"
            data-testid="pdf-outline-close"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-xl text-text-secondary hover:bg-border hover:text-foreground"
            :aria-label="t('common.close')"
            @click="outlineOpen = false"
          >
            ×
          </button>
        </header>
        <div data-testid="pdf-outline" class="min-h-0 flex-1 overflow-y-auto p-2">
          <PdfOutlineItems v-if="outline.length" :items="outline" @navigate="resolveOutlineDestination" />
          <p v-else class="px-2 py-3 text-xs text-text-secondary">{{ t('fileManager.preview.pdfNoOutline') }}</p>
        </div>
      </aside>

      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div
          ref="scroller"
          data-testid="pdf-page-scroller"
          role="region"
          :aria-label="t('fileManager.preview.pdfMeta', { pages: pageCount })"
          class="pdf-scroller min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-black/15 p-3 sm:p-6"
          data-pdf-scroller
          @scroll.passive="queueCurrentPageUpdate"
          @touchstart="handleTouchStart"
          @touchmove="handleTouchMove"
          @touchend="handleTouchEnd"
          @touchcancel="handleTouchEnd"
        >
          <p v-if="loading" class="p-4 text-center text-text-secondary">{{ t('fileManager.preview.loading') }}</p>
          <p v-else-if="error" class="p-4 text-error">{{ error }}</p>
          <div
            v-else-if="document"
            data-testid="pdf-continuous-pages"
            class="pdf-pages-column flex min-h-full w-max min-w-full flex-col gap-3 sm:gap-4"
            :style="pinchScale !== 1 ? { transform: `scale(${pinchScale})` } : undefined"
          >
            <PdfPage
              v-for="pageNumber in pageCount"
              :key="pageNumber"
              :document="document"
              :page-number="pageNumber"
              :available-width="availablePageWidth"
              :fit-width="fitWidth"
              :zoom-percent="zoomPercent"
              :active="active"
              :search-query="searchAppliedQuery"
              :active-search-occurrence="activeSearchMatch?.page === pageNumber ? activeSearchMatch.occurrence : null"
              @scale="handlePageScale"
            />
          </div>
        </div>
        <PreviewHorizontalScrollbar
          :target="scroller"
          test-id="pdf-horizontal-scrollbar"
          :active="active"
          :label="t('fileManager.preview.horizontalScroll')"
        />
      </div>
    </div>
  </FilePreviewDialog>
</template>

<style scoped>
  .pdf-toolbar {
    min-width: 0;
  }

  .pdf-toolbar-button {
    display: flex;
    width: 2rem;
    height: 2rem;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
    color: var(--text-color-secondary);
    font-size: 1rem;
    line-height: 1;
  }

  .pdf-toolbar-button.pdf-toolbar-button-active {
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
  }

  @media (hover: hover) and (pointer: fine) {
    .pdf-toolbar-button:hover:not(:disabled) {
      background: var(--color-border);
      color: var(--text-color-primary);
    }
  }

  .pdf-toolbar-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 1px var(--color-primary);
  }

  .pdf-toolbar-button:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .pdf-outline-drawer {
    transition: transform 160ms ease-out;
  }

  .pdf-pages-column {
    transform-origin: top center;
    will-change: transform;
  }

  .pdf-scroller {
    overscroll-behavior: contain;
    touch-action: pan-x pan-y;
    -webkit-overflow-scrolling: touch;
  }

  @media (max-width: 639px) {
    .pdf-preview-root {
      padding-bottom: 3.35rem;
    }

    .pdf-toolbar {
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 30;
      min-height: 3.35rem;
      overflow-x: auto;
      overscroll-behavior-x: contain;
      border-top: 1px solid var(--color-border);
      background: var(--color-header);
      padding: 0.3rem 0.35rem;
      -webkit-overflow-scrolling: touch;
    }

    .pdf-toolbar-button,
    .pdf-page-input,
    .pdf-fit-width {
      height: 2.75rem;
      min-height: 2.75rem;
    }

    .pdf-toolbar-button {
      width: 2.75rem;
      min-width: 2.75rem;
      font-size: 1.2rem;
    }

    .pdf-page-input {
      width: 3.25rem;
      min-width: 3.25rem;
      font-size: 0.875rem;
    }

    .pdf-fit-width {
      min-width: max-content;
      margin-left: 0;
      padding-right: 0.65rem;
      padding-left: 0.65rem;
    }

    .pdf-toolbar-divider {
      margin-right: 0.15rem;
      margin-left: 0.15rem;
    }

    .pdf-outline-drawer {
      bottom: 3.35rem;
    }
  }
</style>
