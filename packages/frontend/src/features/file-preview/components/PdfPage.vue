<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
  import { useI18n } from 'vue-i18n';
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
  const emit = defineEmits<{ scale: [pageNumber: number, percent: number] }>();
  const { t } = useI18n();
  const root = ref<HTMLElement | null>(null);
  const canvas = ref<HTMLCanvasElement | null>(null);
  const textLayerRoot = ref<HTMLElement | null>(null);
  const baseWidth = ref(0);
  const baseHeight = ref(0);
  const visible = ref(false);
  const rendering = ref(false);
  let observer: IntersectionObserver | null = null;
  let renderTask: RenderTask | null = null;
  let textLayer: TextLayer | null = null;
  let generation = 0;
  let disposed = false;
  let searchMatches: HTMLElement[] = [];

  const scale = computed(() => {
    if (props.fitWidth && baseWidth.value > 0) {
      return Math.min(4, Math.max(0.25, props.availableWidth / baseWidth.value));
    }
    return Math.min(4, Math.max(0.25, props.zoomPercent / 100));
  });
  const displayWidth = computed(() => Math.max(1, Math.round(baseWidth.value * scale.value)));
  const displayHeight = computed(() => Math.max(1, Math.round(baseHeight.value * scale.value)));

  const clearSearch = (): void => {
    searchMatches = [];
    clearPreviewSearchMatches(textLayerRoot.value);
  };

  const applySearch = (): void => {
    searchMatches = highlightPreviewSearchMatches(textLayerRoot.value, props.searchQuery ?? '');
    const activeIndex = props.activeSearchOccurrence ?? -1;
    const active = activatePreviewSearchMatch(searchMatches, activeIndex);
    if (active) {
      if (props.active) active.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }
  };

  const releaseRender = (): void => {
    generation += 1;
    renderTask?.cancel();
    renderTask = null;
    textLayer?.cancel();
    textLayer = null;
    clearSearch();
    textLayerRoot.value?.replaceChildren();
    rendering.value = false;
    if (canvas.value) {
      canvas.value.width = 0;
      canvas.value.height = 0;
    }
  };

  const loadMetrics = async (): Promise<void> => {
    const token = ++generation;
    const page = await props.document.getPage(props.pageNumber);
    if (disposed || token !== generation) return;
    const viewport = page.getViewport({ scale: 1 });
    baseWidth.value = viewport.width;
    baseHeight.value = viewport.height;
    emit('scale', props.pageNumber, scale.value * 100);
    page.cleanup();
  };

  const render = async (): Promise<void> => {
    const target = canvas.value;
    const textTarget = textLayerRoot.value;
    if (!target || !textTarget || !props.active || !visible.value || baseWidth.value <= 0 || disposed) return;

    const token = ++generation;
    renderTask?.cancel();
    textLayer?.cancel();
    textTarget.replaceChildren();
    rendering.value = true;

    const page = await props.document.getPage(props.pageNumber);
    if (disposed || token !== generation) {
      page.cleanup();
      return;
    }

    const viewport = page.getViewport({ scale: scale.value });
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    target.width = Math.max(1, Math.floor(viewport.width * outputScale));
    target.height = Math.max(1, Math.floor(viewport.height * outputScale));
    target.style.width = `${Math.round(viewport.width)}px`;
    target.style.height = `${Math.round(viewport.height)}px`;
    textTarget.style.setProperty('--total-scale-factor', String(viewport.scale));

    const context = target.getContext('2d');
    if (!context) {
      page.cleanup();
      rendering.value = false;
      return;
    }

    renderTask = page.render({
      canvas: target,
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
    });

    const textContent = await page.getTextContent();
    if (disposed || token !== generation) {
      page.cleanup();
      return;
    }
    textLayer = new TextLayer({ textContentSource: textContent, container: textTarget, viewport });

    try {
      await Promise.all([renderTask.promise, textLayer.render()]);
      if (token === generation) applySearch();
    } catch (cause) {
      if (!(cause instanceof Error) || !/cancel/i.test(cause.name)) throw cause;
    } finally {
      if (token === generation) {
        rendering.value = false;
        renderTask = null;
      }
      page.cleanup();
    }
  };

  const observe = (): void => {
    observer?.disconnect();
    if (!root.value) return;
    if (!('IntersectionObserver' in window)) {
      visible.value = true;
      void render();
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        visible.value = entries.some((entry) => entry.isIntersecting);
        if (visible.value) void render();
        else releaseRender();
      },
      { rootMargin: '1000px 0px' },
    );
    observer.observe(root.value);
  };

  watch(scale, () => {
    emit('scale', props.pageNumber, scale.value * 100);
    if (visible.value) void render();
  });
  watch(
    () => props.active,
    (active) => {
      if (active && visible.value) void render();
      else if (!active) releaseRender();
    },
  );
  watch(() => props.searchQuery, applySearch);
  watch(() => props.activeSearchOccurrence, applySearch);
  watch(
    () => props.document,
    async () => {
      releaseRender();
      baseWidth.value = 0;
      baseHeight.value = 0;
      await loadMetrics();
      if (visible.value) await render();
    },
  );

  onMounted(async () => {
    observe();
    await loadMetrics();
    if (visible.value) await render();
  });
  onBeforeUnmount(() => {
    disposed = true;
    observer?.disconnect();
    releaseRender();
  });
</script>

<template>
  <section
    ref="root"
    class="flex min-w-full justify-center"
    :data-testid="`pdf-page-${pageNumber}`"
    :data-pdf-page="pageNumber"
    :data-pdf-page-number="pageNumber"
    :aria-label="t('fileManager.preview.pdfPage', { page: pageNumber })"
  >
    <div
      class="relative shrink-0 bg-white shadow-xl"
      :style="{ width: `${displayWidth}px`, height: `${displayHeight}px` }"
    >
      <div
        v-if="baseWidth <= 0 || rendering"
        class="absolute inset-0 grid place-items-center text-xs text-gray-400"
        aria-hidden="true"
      >
        {{ pageNumber }}
      </div>
      <canvas ref="canvas" class="relative z-0 block bg-white" />
      <div ref="textLayerRoot" class="pdf-text-layer" />
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
    line-height: 1;
    transform-origin: 0 0;
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
