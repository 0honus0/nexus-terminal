<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { FileListItem } from '../../types/sftp.types';
import FilePreviewDialog from './FilePreviewDialog.vue';
import PdfOutlineItems, { type PdfOutlineItem } from './PdfOutlineItems.vue';
import PdfThumbnail from './PdfThumbnail.vue';
import PreviewHorizontalScrollbar from './PreviewHorizontalScrollbar.vue';

const props = withDefaults(defineProps<{
  file: FileListItem;
  document: PDFDocumentProxy;
  outline: PdfOutlineItem[];
  active?: boolean;
}>(), {
  active: true,
});

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const currentPage = ref(1);
const zoomPercent = ref(100);
const effectiveZoomPercent = ref(100);
const fitWidth = ref(true);
const sidebarMode = ref<'thumbnails' | 'outline'>('thumbnails');
const mainScrollerRef = ref<HTMLElement | null>(null);
const mainCanvasRef = ref<HTMLCanvasElement | null>(null);
let renderTask: RenderTask | null = null;
let renderToken = 0;
let resizeObserver: ResizeObserver | null = null;
let resizeFrame = 0;
let disposed = false;

const pageCount = computed(() => props.document.numPages);
const subtitle = computed(() => t('fileManager.preview.pdfMeta', {
  pages: pageCount.value,
}, `PDF · ${pageCount.value} pages`));
const zoomLabel = computed(() => `${Math.round(effectiveZoomPercent.value)}%`);

const clampPage = (value: number) => Math.min(pageCount.value, Math.max(1, Math.round(value)));
const clampZoom = (value: number) => Math.min(400, Math.max(25, Math.round(value)));

const renderCurrentPage = async () => {
  const canvas = mainCanvasRef.value;
  const scroller = mainScrollerRef.value;
  if (!canvas || !scroller || disposed) return;

  const token = ++renderToken;
  renderTask?.cancel();
  renderTask = null;

  const page = await props.document.getPage(currentPage.value);
  if (disposed || token !== renderToken) return;

  const baseViewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(220, scroller.clientWidth - 48);
  const scale = fitWidth.value
    ? Math.min(4, Math.max(0.25, availableWidth / baseViewport.width))
    : clampZoom(zoomPercent.value) / 100;
  const viewport = page.getViewport({ scale });
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);

  effectiveZoomPercent.value = scale * 100;
  canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
  canvas.style.width = `${Math.round(viewport.width)}px`;
  canvas.style.height = `${Math.round(viewport.height)}px`;

  renderTask = page.render({
    canvas,
    viewport,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  });

  try {
    await renderTask.promise;
  } catch (error: any) {
    if (error?.name !== 'RenderingCancelledException' && !disposed) throw error;
  } finally {
    if (token === renderToken) renderTask = null;
    page.cleanup();
  }
};

const scheduleRender = () => {
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    void nextTick(renderCurrentPage);
  });
};

const selectPage = (pageNumber: number) => {
  currentPage.value = clampPage(pageNumber);
  mainScrollerRef.value?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
};

const handlePageInput = (event: Event) => {
  const input = event.currentTarget as HTMLInputElement;
  const parsed = Number(input.value);
  if (Number.isFinite(parsed)) selectPage(parsed);
  input.value = String(currentPage.value);
};

const previousPage = () => selectPage(currentPage.value - 1);
const nextPage = () => selectPage(currentPage.value + 1);

const zoomIn = () => {
  const baseZoom = fitWidth.value ? effectiveZoomPercent.value : zoomPercent.value;
  fitWidth.value = false;
  zoomPercent.value = clampZoom(baseZoom + 25);
};

const zoomOut = () => {
  const baseZoom = fitWidth.value ? effectiveZoomPercent.value : zoomPercent.value;
  fitWidth.value = false;
  zoomPercent.value = clampZoom(baseZoom - 25);
};

const setFitWidth = () => {
  fitWidth.value = true;
  scheduleRender();
};

const resolveOutlineDestination = async (item: PdfOutlineItem) => {
  let destination: unknown = item.dest;
  if (typeof destination === 'string') {
    destination = await props.document.getDestination(destination);
  }
  if (!Array.isArray(destination) || destination.length === 0) return;

  const target = destination[0];
  if (typeof target === 'number') {
    selectPage(target + 1);
    return;
  }

  if (target && typeof target === 'object') {
    try {
      const pageIndex = await props.document.getPageIndex(target as any);
      selectPage(pageIndex + 1);
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

watch([currentPage, zoomPercent, fitWidth], scheduleRender);

watch(() => props.document, () => {
  renderToken += 1;
  renderTask?.cancel();
  renderTask = null;
  currentPage.value = clampPage(currentPage.value);
  scheduleRender();
});

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    if (fitWidth.value) scheduleRender();
  });
  if (mainScrollerRef.value) resizeObserver.observe(mainScrollerRef.value);
  scheduleRender();
});

onBeforeUnmount(() => {
  disposed = true;
  renderToken += 1;
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = 0;
  resizeObserver?.disconnect();
  resizeObserver = null;
  renderTask?.cancel();
  renderTask = null;
});
</script>

<template>
  <FilePreviewDialog
    :file="props.file"
    :subtitle="subtitle"
    :active="props.active"
    @close="emit('close')"
  >
    <template #toolbar>
      <div class="hidden items-center gap-1 sm:flex">
        <button
          type="button"
          class="pdf-toolbar-button"
          :disabled="currentPage <= 1"
          :aria-label="t('fileManager.preview.pdfPreviousPage', 'Previous page')"
          @click="previousPage"
        >
          ‹
        </button>
        <input
          data-testid="pdf-current-page"
          class="h-8 w-14 rounded border border-border bg-background px-1 text-center text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          type="number"
          min="1"
          :max="pageCount"
          :value="currentPage"
          :aria-label="t('fileManager.preview.pdfCurrentPage', 'Current page')"
          @change="handlePageInput"
        >
        <span class="text-xs text-text-secondary">/ <span data-testid="pdf-page-count">{{ pageCount }}</span></span>
        <button
          type="button"
          class="pdf-toolbar-button"
          :disabled="currentPage >= pageCount"
          :aria-label="t('fileManager.preview.pdfNextPage', 'Next page')"
          @click="nextPage"
        >
          ›
        </button>
        <span class="mx-1 h-5 w-px bg-border" />
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
          class="ml-1 h-8 rounded-md border border-border px-2 text-xs text-text-secondary hover:bg-border hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          :class="fitWidth ? 'bg-primary/10 text-primary' : ''"
          :aria-pressed="fitWidth"
          @click="setFitWidth"
        >
          {{ t('fileManager.preview.pdfFitWidth', 'Fit width') }}
        </button>
      </div>
    </template>

    <div
      data-testid="pdf-preview"
      class="flex h-full min-h-0 w-full overflow-hidden outline-none"
      tabindex="0"
      @keydown="handleKeydown"
    >
      <aside class="flex w-44 shrink-0 flex-col border-r border-border bg-header/60 sm:w-52">
        <div class="grid shrink-0 grid-cols-2 border-b border-border p-1">
          <button
            type="button"
            data-testid="pdf-sidebar-thumbnails-tab"
            class="rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            :class="sidebarMode === 'thumbnails' ? 'bg-primary/15 text-primary' : 'text-text-secondary hover:bg-border'"
            :aria-pressed="sidebarMode === 'thumbnails'"
            @click="sidebarMode = 'thumbnails'"
          >
            {{ t('fileManager.preview.pdfThumbnails', 'Pages') }}
          </button>
          <button
            type="button"
            data-testid="pdf-sidebar-outline-tab"
            class="rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            :class="sidebarMode === 'outline' ? 'bg-primary/15 text-primary' : 'text-text-secondary hover:bg-border'"
            :aria-pressed="sidebarMode === 'outline'"
            @click="sidebarMode = 'outline'"
          >
            {{ t('fileManager.preview.pdfOutline', 'Outline') }}
          </button>
        </div>

        <div v-if="sidebarMode === 'thumbnails'" class="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          <PdfThumbnail
            v-for="pageNumber in pageCount"
            :key="pageNumber"
            :document="props.document"
            :page-number="pageNumber"
            :active="pageNumber === currentPage"
            @select="selectPage"
          />
        </div>

        <div v-else data-testid="pdf-outline" class="min-h-0 flex-1 overflow-y-auto p-2">
          <PdfOutlineItems
            v-if="props.outline.length"
            :items="props.outline"
            @navigate="resolveOutlineDestination"
          />
          <p v-else class="px-2 py-3 text-xs text-text-secondary">
            {{ t('fileManager.preview.pdfNoOutline', 'This PDF does not contain a document outline.') }}
          </p>
        </div>
      </aside>

      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main
          ref="mainScrollerRef"
          data-testid="pdf-page-scroller"
          class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-black/15 p-6"
        >
          <div class="flex min-h-full min-w-full items-start justify-center">
            <div
              :data-testid="`pdf-page-${currentPage}`"
              class="bg-white shadow-xl"
            >
              <canvas
                ref="mainCanvasRef"
                class="block bg-white"
              />
            </div>
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

.pdf-toolbar-button:hover:not(:disabled) {
  background: var(--color-border);
  color: var(--text-color-primary);
}

.pdf-toolbar-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px var(--color-primary);
}

.pdf-toolbar-button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
</style>
