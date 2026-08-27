<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

const props = defineProps<{
  document: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
}>();

const emit = defineEmits<{
  select: [pageNumber: number];
}>();

const rootRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
let observer: IntersectionObserver | null = null;
let renderTask: RenderTask | null = null;
let rendered = false;
let disposed = false;

const render = async () => {
  if (rendered || disposed) return;
  const canvas = canvasRef.value;
  if (!canvas) return;

  const page = await props.document.getPage(props.pageNumber);
  if (disposed) return;
  const baseViewport = page.getViewport({ scale: 1 });
  const targetWidth = 116;
  const scale = targetWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });
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
    rendered = true;
  } catch (error: any) {
    if (error?.name !== 'RenderingCancelledException' && !disposed) throw error;
  } finally {
    renderTask = null;
    page.cleanup();
  }
};

onMounted(() => {
  if (!('IntersectionObserver' in window)) {
    void render();
    return;
  }

  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      observer?.disconnect();
      observer = null;
      void render();
    }
  }, { rootMargin: '160px' });

  if (rootRef.value) observer.observe(rootRef.value);
});

onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  observer = null;
  renderTask?.cancel();
  renderTask = null;
});
</script>

<template>
  <button
    ref="rootRef"
    type="button"
    :data-testid="`pdf-thumbnail-${props.pageNumber}`"
    class="flex w-full flex-col items-center gap-1 rounded-md border p-2 transition-colors focus:outline-none focus:ring-1 focus:ring-primary"
    :class="props.active
      ? 'border-primary bg-primary/10'
      : 'border-border bg-background hover:bg-border'"
    :aria-current="props.active ? 'page' : undefined"
    @click="emit('select', props.pageNumber)"
  >
    <canvas ref="canvasRef" class="max-w-full bg-white shadow" />
    <span class="text-[11px] text-text-secondary">{{ props.pageNumber }}</span>
  </button>
</template>
