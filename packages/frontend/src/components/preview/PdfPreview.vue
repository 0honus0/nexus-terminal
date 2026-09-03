<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import type { FileListItem } from '../../types/sftp.types';
  import FilePreviewDialog from './FilePreviewDialog.vue';
  import PdfContinuousPage from './PdfContinuousPage.vue';
  import PdfOutlineItems, { type PdfOutlineItem } from './PdfOutlineItems.vue';
  import PreviewSearchBar from './PreviewSearchBar.vue';
  import PreviewHorizontalScrollbar from './PreviewHorizontalScrollbar.vue';

  interface PdfSearchMatch {
    page: number;
    occurrence: number;
  }

  const props = withDefaults(
    defineProps<{
      file: FileListItem;
      document: PDFDocumentProxy;
      outline: PdfOutlineItem[];
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
  const currentPage = ref(1);
  const zoomPercent = ref(100);
  const fitWidth = ref(true);
  const pinchScale = ref(1);
  const pinchPreviewPercent = ref<number | null>(null);
  const outlineOpen = ref(false);
  const desktopOutlinePersistent = ref(false);
  const desktopOutlineVisible = ref(true);
  const availablePageWidth = ref(220);
  const pageScalePercents = ref<Record<number, number>>({});
  const mainScrollerRef = ref<HTMLElement | null>(null);
  const searchOpen = ref(false);
  const searchQuery = ref('');
  const searchAppliedQuery = ref('');
  const searchBusy = ref(false);
  const searchMatches = ref<PdfSearchMatch[]>([]);
  const activeSearchIndex = ref(-1);

  let resizeObserver: ResizeObserver | null = null;
  let desktopOutlineMediaQuery: MediaQueryList | null = null;
  let scrollFrame = 0;
  let restoreFrame = 0;
  let restoringScrollPosition = false;
  let savedScrollTop = 0;
  let savedScrollLeft = 0;
  let savedCurrentPage = 1;
  let savedNeedsPageAnchor = false;
  let pendingPageJump: { page: number; behavior: ScrollBehavior } | null = null;
  let searchIndexDocument: PDFDocumentProxy | null = null;
  let searchIndexPromise: Promise<void> | null = null;
  let searchPageTextItems: string[][] = [];
  let searchToken = 0;
  let pinchGesture: {
    startDistance: number;
    startZoom: number;
    targetZoom: number;
  } | null = null;

  const pageCount = computed(() => props.document.numPages);
  const subtitle = computed(() =>
    t(
      'fileManager.preview.pdfMeta',
      {
        pages: pageCount.value,
      },
      `PDF · ${pageCount.value} pages`,
    ),
  );
  const currentFitZoom = computed(
    () => pageScalePercents.value[currentPage.value] ?? pageScalePercents.value[1] ?? 100,
  );
  const displayedZoomPercent = computed(
    () => pinchPreviewPercent.value ?? (fitWidth.value ? currentFitZoom.value : zoomPercent.value),
  );
  const zoomLabel = computed(() => `${Math.round(displayedZoomPercent.value)}%`);
  const outlineVisible = computed(() =>
    desktopOutlinePersistent.value ? desktopOutlineVisible.value : outlineOpen.value,
  );
  const outlineHidden = computed(() => !outlineVisible.value);
  const activeSearchMatch = computed(() => searchMatches.value[activeSearchIndex.value] ?? null);

  const clampPage = (value: number) => Math.min(pageCount.value, Math.max(1, Math.round(value)));
  const clampZoom = (value: number) => Math.min(400, Math.max(25, Math.round(value)));

  const updateAvailableWidth = () => {
    const scroller = mainScrollerRef.value;
    if (!scroller || !props.active || scroller.clientWidth < 32) return false;
    const style = getComputedStyle(scroller);
    const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    const nextWidth = Math.max(220, scroller.clientWidth - horizontalPadding);
    const changed = Math.abs(nextWidth - availablePageWidth.value) > 1;
    availablePageWidth.value = nextWidth;
    return changed;
  };

  const pageElement = (pageNumber: number) =>
    mainScrollerRef.value?.querySelector<HTMLElement>(`[data-pdf-page-number="${pageNumber}"]`) ?? null;

  const applyPageScroll = (page: number, behavior: ScrollBehavior) => {
    const scroller = mainScrollerRef.value;
    const element = pageElement(page);
    if (!scroller || !element) return false;
    const pageRect = element.getBoundingClientRect();
    if (pageRect.height < 32) return false;
    const scrollerRect = scroller.getBoundingClientRect();
    const top = Math.max(0, scroller.scrollTop + pageRect.top - scrollerRect.top - 8);
    scroller.scrollTo({ top, left: 0, behavior });
    return true;
  };

  const hasMeasuredPagesThrough = (page: number) => {
    for (let pageNumber = 1; pageNumber <= page; pageNumber += 1) {
      if (pageScalePercents.value[pageNumber] == null) return false;
    }
    return true;
  };

  const finishPendingPageJump = () => {
    const pending = pendingPageJump;
    if (!pending || !props.active) return false;
    if (!hasMeasuredPagesThrough(pending.page)) return false;
    if (!applyPageScroll(pending.page, pending.behavior)) return false;
    pendingPageJump = null;
    savedNeedsPageAnchor = false;
    return true;
  };

  const scrollToPage = (pageNumber: number, behavior: ScrollBehavior = 'auto') => {
    const page = clampPage(pageNumber);
    currentPage.value = page;
    outlineOpen.value = false;
    pendingPageJump = { page, behavior };
    if (!finishPendingPageJump()) void nextTick(finishPendingPageJump);
  };

  const updateCurrentPageFromScroll = () => {
    scrollFrame = 0;
    if (restoringScrollPosition || pendingPageJump || !props.active) return;
    const scroller = mainScrollerRef.value;
    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const focusY = scrollerRect.top + Math.min(scroller.clientHeight * 0.35, 260);
    const pages = Array.from(scroller.querySelectorAll<HTMLElement>('[data-pdf-page-number]'));
    let bestPage = currentPage.value;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const element of pages) {
      const rect = element.getBoundingClientRect();
      if (rect.height < 32) continue;
      if (rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom) continue;
      const distance = focusY < rect.top ? rect.top - focusY : focusY > rect.bottom ? focusY - rect.bottom : 0;
      if (distance >= bestDistance) continue;
      const page = Number(element.dataset.pdfPageNumber);
      if (!Number.isFinite(page)) continue;
      bestPage = page;
      bestDistance = distance;
      if (distance === 0) break;
    }

    currentPage.value = clampPage(bestPage);
  };

  const queueCurrentPageUpdate = () => {
    if (restoringScrollPosition || pendingPageJump || !props.active || scrollFrame) return;
    scrollFrame = requestAnimationFrame(updateCurrentPageFromScroll);
  };

  const handlePageInput = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) scrollToPage(parsed);
    input.value = String(currentPage.value);
  };

  const previousPage = () => scrollToPage(currentPage.value - 1);
  const nextPage = () => scrollToPage(currentPage.value + 1);

  const ensureSearchIndex = async () => {
    if (searchIndexDocument === props.document && searchPageTextItems.length === pageCount.value) return;
    if (searchIndexPromise && searchIndexDocument === props.document) {
      await searchIndexPromise;
      return;
    }

    const targetDocument = props.document;
    searchIndexDocument = targetDocument;
    searchPageTextItems = Array.from({ length: targetDocument.numPages }, () => []);
    searchIndexPromise = (async () => {
      let nextPageIndex = 0;
      const workerCount = Math.min(4, targetDocument.numPages);
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (nextPageIndex < targetDocument.numPages) {
            const pageIndex = nextPageIndex;
            nextPageIndex += 1;
            const page = await targetDocument.getPage(pageIndex + 1);
            const textContent = await page.getTextContent();
            searchPageTextItems[pageIndex] = textContent.items.flatMap((item) =>
              'str' in item && typeof item.str === 'string' ? [item.str] : [],
            );
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

  const activatePdfSearchIndex = (index: number, behavior: ScrollBehavior = 'smooth') => {
    const count = searchMatches.value.length;
    if (count === 0) {
      activeSearchIndex.value = -1;
      return;
    }
    activeSearchIndex.value = ((index % count) + count) % count;
    scrollToPage(searchMatches.value[activeSearchIndex.value].page, behavior);
  };

  const runPdfSearch = async (value: string) => {
    searchQuery.value = value;
    const query = value.trim().toLocaleLowerCase();
    const token = ++searchToken;

    if (!query) {
      searchBusy.value = false;
      searchAppliedQuery.value = '';
      searchMatches.value = [];
      activeSearchIndex.value = -1;
      return;
    }

    searchBusy.value = true;
    try {
      await ensureSearchIndex();
      if (token !== searchToken) return;

      const matches: PdfSearchMatch[] = [];
      searchPageTextItems.forEach((items, pageIndex) => {
        let occurrenceOnPage = 0;
        for (const item of items) {
          const text = item.toLocaleLowerCase();
          let offset = text.indexOf(query);
          while (offset >= 0) {
            matches.push({ page: pageIndex + 1, occurrence: occurrenceOnPage });
            occurrenceOnPage += 1;
            offset = text.indexOf(query, offset + query.length);
          }
        }
      });

      searchAppliedQuery.value = value.trim();
      searchMatches.value = matches;
      if (matches.length > 0) activatePdfSearchIndex(0, 'auto');
      else activeSearchIndex.value = -1;
    } finally {
      if (token === searchToken) searchBusy.value = false;
    }
  };

  const openSearch = () => {
    searchOpen.value = true;
  };

  const closeSearch = () => {
    searchOpen.value = false;
    searchToken += 1;
    searchBusy.value = false;
    searchQuery.value = '';
    searchAppliedQuery.value = '';
    searchMatches.value = [];
    activeSearchIndex.value = -1;
  };

  const nextSearchMatch = () => activatePdfSearchIndex(activeSearchIndex.value + 1);
  const previousSearchMatch = () => activatePdfSearchIndex(activeSearchIndex.value - 1);

  const syncOutlineLayout = () => {
    const wasDesktop = desktopOutlinePersistent.value;
    desktopOutlinePersistent.value = desktopOutlineMediaQuery?.matches ?? false;
    outlineOpen.value = false;
    if (!wasDesktop && desktopOutlinePersistent.value) desktopOutlineVisible.value = true;
  };

  const toggleOutline = () => {
    if (desktopOutlinePersistent.value) {
      desktopOutlineVisible.value = !desktopOutlineVisible.value;
      return;
    }
    outlineOpen.value = !outlineOpen.value;
  };

  const anchorAfterZoom = (pageNumber: number) => {
    void nextTick(() => requestAnimationFrame(() => scrollToPage(pageNumber, 'auto')));
  };

  const zoomIn = () => {
    const anchorPage = currentPage.value;
    zoomPercent.value = clampZoom(displayedZoomPercent.value + 25);
    fitWidth.value = false;
    anchorAfterZoom(anchorPage);
  };

  const zoomOut = () => {
    const anchorPage = currentPage.value;
    zoomPercent.value = clampZoom(displayedZoomPercent.value - 25);
    fitWidth.value = false;
    anchorAfterZoom(anchorPage);
  };

  const setFitWidth = () => {
    const anchorPage = currentPage.value;
    fitWidth.value = true;
    anchorAfterZoom(anchorPage);
  };

  const handlePageScale = (pageNumber: number, percent: number) => {
    pageScalePercents.value = {
      ...pageScalePercents.value,
      [pageNumber]: percent,
    };
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

  const touchDistance = (first: Touch, second: Touch) =>
    Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);

  const handlePdfTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 2) {
      pinchGesture = null;
      return;
    }
    const distance = touchDistance(event.touches[0], event.touches[1]);
    if (distance <= 0) return;
    const startZoom = displayedZoomPercent.value;
    pinchGesture = {
      startDistance: distance,
      startZoom,
      targetZoom: startZoom,
    };
  };

  const handlePdfTouchMove = (event: TouchEvent) => {
    if (!pinchGesture || event.touches.length !== 2) return;
    const distance = touchDistance(event.touches[0], event.touches[1]);
    if (distance <= 0) return;
    event.preventDefault();
    pinchGesture.targetZoom = clampZoom(pinchGesture.startZoom * (distance / pinchGesture.startDistance));
    pinchPreviewPercent.value = pinchGesture.targetZoom;
    pinchScale.value = pinchGesture.targetZoom / pinchGesture.startZoom;
  };

  const commitPinchZoom = () => {
    if (!pinchGesture) return;
    const anchorPage = currentPage.value;
    const { startZoom, targetZoom } = pinchGesture;
    pinchGesture = null;
    pinchPreviewPercent.value = null;
    if (Math.abs(targetZoom - startZoom) < 2) {
      pinchScale.value = 1;
      return;
    }
    fitWidth.value = false;
    zoomPercent.value = targetZoom;
    void nextTick(() =>
      requestAnimationFrame(() => {
        pinchScale.value = 1;
        scrollToPage(anchorPage, 'auto');
      }),
    );
  };

  const handlePdfTouchEnd = (event: TouchEvent) => {
    if (event.touches.length < 2) commitPinchZoom();
  };

  const resolveOutlineDestination = async (item: PdfOutlineItem) => {
    let destination: unknown = item.dest;
    if (typeof destination === 'string') {
      destination = await props.document.getDestination(destination);
    }
    if (!Array.isArray(destination) || destination.length === 0) return;

    const target = destination[0];
    if (typeof target === 'number') {
      scrollToPage(target + 1);
      return;
    }

    if (target && typeof target === 'object') {
      try {
        const pageIndex = await props.document.getPageIndex(target as any);
        scrollToPage(pageIndex + 1);
      } catch (error) {
        console.warn('[PdfPreview] Failed to resolve outline destination', error);
      }
    }
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'PageUp') {
      event.preventDefault();
      previousPage();
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      nextPage();
    }
  };

  watch(
    () => props.active,
    (active) => {
      if (!active) {
        const scroller = mainScrollerRef.value;
        savedScrollTop = scroller?.scrollTop ?? savedScrollTop;
        savedScrollLeft = scroller?.scrollLeft ?? savedScrollLeft;
        savedCurrentPage = currentPage.value;
        savedNeedsPageAnchor = Boolean(pendingPageJump);
        restoringScrollPosition = false;
        if (scrollFrame) cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
        if (restoreFrame) cancelAnimationFrame(restoreFrame);
        restoreFrame = 0;
        outlineOpen.value = false;
        pinchGesture = null;
        pinchPreviewPercent.value = null;
        pinchScale.value = 1;
        return;
      }

      restoringScrollPosition = true;
      currentPage.value = clampPage(savedCurrentPage);
      void nextTick(() => {
        restoreFrame = requestAnimationFrame(() => {
          restoreFrame = 0;
          if (updateAvailableWidth()) savedNeedsPageAnchor = true;
          if (savedNeedsPageAnchor) {
            restoringScrollPosition = false;
            scrollToPage(savedCurrentPage, 'auto');
            return;
          }
          const scroller = mainScrollerRef.value;
          scroller?.scrollTo({
            top: savedScrollTop,
            left: savedScrollLeft,
            behavior: 'auto',
          });
          restoreFrame = requestAnimationFrame(() => {
            restoreFrame = 0;
            currentPage.value = clampPage(savedCurrentPage);
            restoringScrollPosition = false;
            queueCurrentPageUpdate();
          });
        });
      });
    },
  );

  watch(
    () => props.document,
    () => {
      const preservedPage = clampPage(currentPage.value);
      searchToken += 1;
      searchIndexDocument = null;
      searchIndexPromise = null;
      searchPageTextItems = [];
      searchMatches.value = [];
      activeSearchIndex.value = -1;
      searchAppliedQuery.value = '';
      searchBusy.value = false;
      pageScalePercents.value = {};
      if (searchQuery.value.trim()) void runPdfSearch(searchQuery.value);
      void nextTick(() => {
        updateAvailableWidth();
        window.setTimeout(() => scrollToPage(preservedPage, 'auto'), 80);
      });
    },
  );

  onMounted(() => {
    desktopOutlineMediaQuery = window.matchMedia('(min-width: 640px)');
    syncOutlineLayout();
    desktopOutlineMediaQuery.addEventListener('change', syncOutlineLayout);
    resizeObserver = new ResizeObserver(() => {
      if (!updateAvailableWidth()) return;
      anchorAfterZoom(currentPage.value);
    });
    if (mainScrollerRef.value) resizeObserver.observe(mainScrollerRef.value);
    updateAvailableWidth();
    queueCurrentPageUpdate();
  });

  onBeforeUnmount(() => {
    searchToken += 1;
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    if (restoreFrame) cancelAnimationFrame(restoreFrame);
    restoreFrame = 0;
    resizeObserver?.disconnect();
    resizeObserver = null;
    desktopOutlineMediaQuery?.removeEventListener('change', syncOutlineLayout);
    desktopOutlineMediaQuery = null;
  });
</script>

<template>
  <FilePreviewDialog :file="props.file" :subtitle="subtitle" :active="props.active" @close="emit('close')">
    <template #toolbar>
      <div class="pdf-toolbar flex items-center gap-1">
        <PreviewSearchBar
          :open="searchOpen"
          :query="searchQuery"
          :current="activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0"
          :total="searchMatches.length"
          :active="props.active"
          :busy="searchBusy"
          @open="openSearch"
          @close="closeSearch"
          @update:query="runPdfSearch"
          @previous="previousSearchMatch"
          @next="nextSearchMatch"
        />
        <span class="pdf-toolbar-divider mx-1 h-5 w-px bg-border" />
        <button
          type="button"
          data-testid="pdf-previous-page"
          class="pdf-toolbar-button"
          :disabled="currentPage <= 1"
          :aria-label="t('fileManager.preview.pdfPreviousPage', 'Previous page')"
          @click="previousPage"
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
          :aria-label="t('fileManager.preview.pdfCurrentPage', 'Current page')"
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
          :aria-label="t('fileManager.preview.pdfNextPage', 'Next page')"
          @click="nextPage"
        >
          ›
        </button>
        <span class="pdf-toolbar-divider mx-1 h-5 w-px bg-border" />
        <button
          type="button"
          data-testid="pdf-zoom-out"
          class="pdf-toolbar-button"
          :aria-label="t('fileManager.preview.pdfZoomOut', 'Zoom out')"
          @click="zoomOut"
        >
          −
        </button>
        <span data-testid="pdf-zoom-label" class="w-12 text-center text-xs text-text-secondary">{{ zoomLabel }}</span>
        <button
          type="button"
          data-testid="pdf-zoom-in"
          class="pdf-toolbar-button"
          :aria-label="t('fileManager.preview.pdfZoomIn', 'Zoom in')"
          @click="zoomIn"
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
          {{ t('fileManager.preview.pdfFitWidth', 'Fit width') }}
        </button>
        <button
          type="button"
          data-testid="pdf-outline-toggle"
          class="pdf-toolbar-button"
          :class="{ 'pdf-toolbar-button-active': outlineVisible }"
          :aria-expanded="outlineVisible"
          :aria-pressed="outlineVisible"
          :aria-label="t('fileManager.preview.pdfOutline', 'Outline')"
          :title="t('fileManager.preview.pdfOutline', 'Outline')"
          @click="toggleOutline"
        >
          <i class="fas fa-list-ul" aria-hidden="true"></i>
        </button>
      </div>
    </template>

    <div
      data-testid="pdf-preview"
      class="pdf-preview-root relative flex h-full min-h-0 w-full overflow-hidden outline-none"
      tabindex="0"
      @keydown="handleKeydown"
    >
      <button
        v-if="outlineOpen && !desktopOutlinePersistent"
        type="button"
        class="absolute inset-0 z-10 bg-black/35"
        :aria-label="t('common.close', 'Close')"
        @click="outlineOpen = false"
      ></button>
      <aside
        data-testid="pdf-outline-drawer"
        class="pdf-outline-drawer absolute inset-y-0 left-0 z-20 flex w-[min(82vw,18rem)] flex-col border-r border-border bg-header/95 shadow-xl sm:relative sm:inset-auto sm:z-auto sm:w-52 sm:shrink-0 sm:translate-x-0 sm:pointer-events-auto sm:shadow-none"
        :class="outlineOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'"
        :style="desktopOutlinePersistent && !desktopOutlineVisible ? { display: 'none' } : undefined"
        :aria-hidden="outlineHidden"
      >
        <header class="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          <strong class="truncate text-sm font-medium">{{ t('fileManager.preview.pdfOutline', 'Outline') }}</strong>
          <button
            v-if="!desktopOutlinePersistent"
            type="button"
            data-testid="pdf-outline-close"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-xl text-text-secondary hover:bg-border hover:text-foreground"
            :aria-label="t('common.close', 'Close')"
            @click="outlineOpen = false"
          >
            ×
          </button>
        </header>
        <div data-testid="pdf-outline" class="min-h-0 flex-1 overflow-y-auto p-2">
          <PdfOutlineItems v-if="props.outline.length" :items="props.outline" @navigate="resolveOutlineDestination" />
          <p v-else class="px-2 py-3 text-xs text-text-secondary">
            {{ t('fileManager.preview.pdfNoOutline', 'This PDF does not contain a document outline.') }}
          </p>
        </div>
      </aside>

      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main
          ref="mainScrollerRef"
          data-testid="pdf-page-scroller"
          class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-black/15 p-3 sm:p-6"
          @scroll="queueCurrentPageUpdate"
          @touchstart="handlePdfTouchStart"
          @touchmove="handlePdfTouchMove"
          @touchend="handlePdfTouchEnd"
          @touchcancel="handlePdfTouchEnd"
        >
          <div
            data-testid="pdf-continuous-pages"
            class="pdf-pages-column flex min-h-full w-max min-w-full flex-col gap-3 sm:gap-4"
            :style="pinchScale !== 1 ? { transform: `scale(${pinchScale})` } : undefined"
          >
            <PdfContinuousPage
              v-for="pageNumber in pageCount"
              :key="pageNumber"
              :document="props.document"
              :page-number="pageNumber"
              :available-width="availablePageWidth"
              :fit-width="fitWidth"
              :zoom-percent="zoomPercent"
              :active="props.active"
              :search-query="searchAppliedQuery"
              :active-search-occurrence="activeSearchMatch?.page === pageNumber ? activeSearchMatch.occurrence : null"
              @scale="handlePageScale"
            />
          </div>
        </main>
        <PreviewHorizontalScrollbar
          :target="mainScrollerRef"
          test-id="pdf-horizontal-scrollbar"
          :active="props.active"
          :label="t('fileManager.preview.horizontalScroll', 'Horizontal scroll')"
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
    height: 2rem;
    width: 2rem;
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
      margin-left: 0;
      min-width: max-content;
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
