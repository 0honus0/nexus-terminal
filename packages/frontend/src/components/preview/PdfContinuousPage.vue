<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

const props = defineProps<{
  document: PDFDocumentProxy;
  pageNumber: number;
  availableWidth: number;
  fitWidth: boolean;
  zoomPercent: number;
  active: boolean;
}>();

const emit = defineEmits<{
  scale: [pageNumber: number, percent: number];
}>();

const rootRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const baseWidth = ref(0);
const baseHeight = ref(0);
const isVisible = ref(false);
const isRendering = ref(false);

let observer: IntersectionObserver | null = null;
let renderTask: RenderTask | null = null;
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

const releaseCanvas = () => {
  renderToken += 1;
  renderTask?.cancel();
  renderTask = null;
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

  try {
    await renderTask.promise;
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

watch(() => props.document, () => {
  metadataToken += 1;
  renderToken += 1;
  renderTask?.cancel();
  renderTask = null;
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
  observer?.disconnect();
  observer = null;
  renderTask?.cancel();
  renderTask = null;
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
      <canvas ref="canvasRef" class="relative block bg-white" />
    </div>
  </section>
</template>
