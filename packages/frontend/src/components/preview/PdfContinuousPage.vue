<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import {
  activatePreviewSearchMatch,
  clearPreviewSearchMatches,
  highlightPreviewSearchMatches,
} from './previewDomSearch';

const props = defineProps<{
  document: PDFDocumentProxy;
  pageNumber: number;
  availableWidth: number;
  fitWidth: boolean;
  zoomPercent: number;
  active: boolean;
  searchQuery?: string;
  activeSearchOccurrence?: number | null;
}>();

const emit = defineEmits<{
  scale: [pageNumber: number, percent: number];
}>();

const rootRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const textLayerRef = ref<HTMLElement | null>(null);
const baseWidth = ref(0);
const baseHeight = ref(0);
const isVisible = ref(false);
const isRendering = ref(false);

let observer: IntersectionObserver | null = null;
let renderTask: RenderTask | null = null;
let textLayer: TextLayer | null = null;
let textLayerToken = 0;
let searchMatches: HTMLElement[] = [];
let metadataToken = 0;
let renderToken = 0;
let disposed = false;

const clampZoom = (value: number) => Math.min(400, Math.max(25, value));
const scale = computed(() => {
  if (props.fitWidth && baseWidth.value > 0) {
    return Math.min(4, Math.max(0.25, props.availableWidth / baseWidth.value));
  }
  return clampZoom(props.zoomPercent) / 100;
});

const displayWidth = computed(() => Math.max(1, Math.round(baseWidth.value * scale.value)));
const displayHeight = computed(() => Math.max(1, Math.round(baseHeight.value * scale.value)));

const loadMetrics = async () => {
  const token = ++metadataToken;
  const page = await props.document.getPage(props.pageNumber);
  if (disposed || token !== metadataToken) return;
  const viewport = page.getViewport({ scale: 1 });
  baseWidth.value = viewport.width;
  baseHeight.value = viewport.height;
  page.cleanup();
};

const focusActiveSearchMatch = (behavior: ScrollBehavior = 'smooth') => {
  const activeIndex = props.activeSearchOccurrence ?? -1;
  const match = activatePreviewSearchMatch(searchMatches, activeIndex);
  if (match && props.active) match.scrollIntoView({ block: 'center', inline: 'nearest', behavior });
};

const applySearchHighlights = (behavior: ScrollBehavior = 'auto') => {
  searchMatches = highlightPreviewSearchMatches(textLayerRef.value, props.searchQuery ?? '');
  if ((props.activeSearchOccurrence ?? -1) >= 0) focusActiveSearchMatch(behavior);
};

const renderTextLayer = async (
  page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>,
  viewport: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getViewport']>,
) => {
  const container = textLayerRef.value;
  if (!container || disposed) return;
  const token = ++textLayerToken;
  textLayer?.cancel();
  textLayer = null;
  searchMatches = [];
  clearPreviewSearchMatches(container);
  container.replaceChildren();
  container.style.setProperty('--total-scale-factor', String(viewport.scale));

  const textContent = await page.getTextContent();
  if (disposed || token !== textLayerToken || !props.active || !isVisible.value) return;

  const layer = new TextLayer({ textContentSource: textContent, container, viewport });
  textLayer = layer;
  await layer.render();
  if (disposed || token !== textLayerToken) return;
  applySearchHighlights();
};

const releaseCanvas = () => {
  renderToken += 1;
  textLayerToken += 1;
  renderTask?.cancel();
  renderTask = null;
  textLayer?.cancel();
  textLayer = null;
  searchMatches = [];
  if (textLayerRef.value) textLayerRef.value.replaceChildren();
  isRendering.value = false;
  const canvas = canvasRef.value;
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.width = '0px';
  canvas.style.height = '0px';
};

const renderPage = async () => {
  const canvas = canvasRef.value;
  if (!canvas || !props.active || !isVisible.value || baseWidth.value <= 0 || disposed) return;

  const token = ++renderToken;
  renderTask?.cancel();
  renderTask = null;
  isRendering.value = true;

  const page = await props.document.getPage(props.pageNumber);
  if (disposed || token !== renderToken) {
    page.cleanup();
    return;
  }

  const viewport = page.getViewport({ scale: scale.value });
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
  canvas.style.width = `${Math.round(viewport.width)}px`;
  canvas.style.height = `${Math.round(viewport.height)}px`;

  renderTask = page.render({
    canvas,
    viewport,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  });
  const textLayerPromise = renderTextLayer(page, viewport).catch((error: any) => {
    if (error?.name !== 'AbortException' && !disposed) {
      console.warn(`[PdfContinuousPage] Failed to render text layer for page ${props.pageNumber}`, error);
    }
  });

  try {
    await Promise.all([renderTask.promise, textLayerPromise]);
  } catch (error: any) {
    if (error?.name !== 'RenderingCancelledException' && !disposed) throw error;
  } finally {
    if (token === renderToken) {
      renderTask = null;
      isRendering.value = false;
    }
    page.cleanup();
  }
};

const observeVisibility = () => {
  observer?.disconnect();
  observer = null;
  if (!rootRef.value) return;

  if (!('IntersectionObserver' in window)) {
    isVisible.value = true;
    void renderPage();
    return;
  }

  observer = new IntersectionObserver((entries) => {
    const visible = entries.some((entry) => entry.isIntersecting);
    isVisible.value = visible;
    if (visible) {
      void renderPage();
    } else {
      releaseCanvas();
    }
  }, { rootMargin: '1200px 0px' });
  observer.observe(rootRef.value);
};

watch(scale, (nextScale) => {
  emit('scale', props.pageNumber, nextScale * 100);
  if (isVisible.value) void renderPage();
});

watch(() => props.active, (active) => {
  if (active && isVisible.value) {
    void renderPage();
  } else if (!active) {
    releaseCanvas();
  }
});

watch(() => props.searchQuery, () => {
  applySearchHighlights();
});

watch(() => props.activeSearchOccurrence, () => {
  focusActiveSearchMatch();
});

watch(() => props.document, () => {
  metadataToken += 1;
  renderToken += 1;
  textLayerToken += 1;
  renderTask?.cancel();
  renderTask = null;
  textLayer?.cancel();
  textLayer = null;
  searchMatches = [];
  if (textLayerRef.value) textLayerRef.value.replaceChildren();
  baseWidth.value = 0;
  baseHeight.value = 0;
  void loadMetrics().then(() => {
    emit('scale', props.pageNumber, scale.value * 100);
    if (isVisible.value) void renderPage();
  });
});

onMounted(() => {
  observeVisibility();
  void loadMetrics().then(() => {
    emit('scale', props.pageNumber, scale.value * 100);
    if (isVisible.value) void renderPage();
  });
});

onBeforeUnmount(() => {
  disposed = true;
  metadataToken += 1;
  renderToken += 1;
  textLayerToken += 1;
  observer?.disconnect();
  observer = null;
  renderTask?.cancel();
  renderTask = null;
  textLayer?.cancel();
  textLayer = null;
});
</script>

<template>
  <section
    ref="rootRef"
    :data-testid="`pdf-page-${props.pageNumber}`"
    :data-pdf-page-number="props.pageNumber"
    class="pdf-continuous-page flex min-w-full justify-center"
    :aria-label="`PDF page ${props.pageNumber}`"
  >
    <div
      class="relative shrink-0 bg-white shadow-xl"
      :style="{
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
      }"
    >
      <div
        v-if="baseWidth <= 0 || isRendering"
        class="absolute inset-0 flex items-center justify-center text-xs text-gray-400"
        aria-hidden="true"
      >
        {{ props.pageNumber }}
      </div>
      <canvas ref="canvasRef" class="relative z-0 block bg-white" />
      <div ref="textLayerRef" class="pdf-text-layer" />
    </div>
  </section>
</template>

<style scoped>
.pdf-text-layer {
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: clip;
  color-scheme: only light;
  text-align: initial;
  line-height: 1;
  letter-spacing: normal;
  word-spacing: normal;
  transform-origin: 0 0;
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
  forced-color-adjust: none;
}

.pdf-text-layer :deep(span),
.pdf-text-layer :deep(br) {
  position: absolute;
  color: transparent;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
}

.pdf-text-layer :deep(> :not(.markedContent)),
.pdf-text-layer :deep(.markedContent span:not(.markedContent)) {
  z-index: 1;
  --font-height: 0;
  --scale-x: 1;
  --rotate: 0deg;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}

.pdf-text-layer :deep(.markedContent) {
  display: contents;
}

.pdf-text-layer :deep(mark[data-preview-search-match]) {
  border-radius: 1px;
  background: rgba(255, 210, 0, 0.48);
  color: transparent;
  padding: 0;
}

.pdf-text-layer :deep(mark[data-preview-search-active]) {
  background: rgba(99, 102, 241, 0.5);
  outline: 1px solid rgba(99, 102, 241, 0.85);
}
</style>
