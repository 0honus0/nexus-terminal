<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  target: HTMLElement | null;
  testId: string;
  label?: string;
  active?: boolean;
}>(), {
  label: 'Horizontal scroll',
  active: true,
});

const trackRef = ref<HTMLElement | null>(null);
const contentWidth = ref(0);
const viewportWidth = ref(0);
const hasOverflow = computed(() => contentWidth.value > viewportWidth.value + 1);

let observedTarget: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let refreshFrame = 0;

const syncTrackFromTarget = () => {
  if (!observedTarget || !trackRef.value) return;
  if (Math.abs(trackRef.value.scrollLeft - observedTarget.scrollLeft) <= 1) return;
  trackRef.value.scrollLeft = observedTarget.scrollLeft;
};

const refreshMetrics = () => {
  refreshFrame = 0;
  if (!observedTarget) {
    contentWidth.value = 0;
    viewportWidth.value = 0;
    return;
  }

  viewportWidth.value = observedTarget.clientWidth;
  contentWidth.value = Math.max(observedTarget.clientWidth, observedTarget.scrollWidth);
  syncTrackFromTarget();
};

const queueRefresh = () => {
  if (refreshFrame) cancelAnimationFrame(refreshFrame);
  refreshFrame = requestAnimationFrame(refreshMetrics);
};

const handleTargetScroll = () => syncTrackFromTarget();

const handleTrackScroll = () => {
  if (!observedTarget || !trackRef.value) return;
  if (Math.abs(observedTarget.scrollLeft - trackRef.value.scrollLeft) <= 1) return;
  observedTarget.scrollLeft = trackRef.value.scrollLeft;
};

const observeTargetChildren = () => {
  if (!resizeObserver || !observedTarget) return;
  for (const child of Array.from(observedTarget.children)) resizeObserver.observe(child);
};

const detachTarget = () => {
  observedTarget?.removeEventListener('scroll', handleTargetScroll);
  window.removeEventListener('resize', queueRefresh);
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  resizeObserver = null;
  mutationObserver = null;
  observedTarget = null;
};

const attachTarget = (target: HTMLElement | null) => {
  detachTarget();
  observedTarget = target;
  if (!target) {
    refreshMetrics();
    return;
  }

  target.addEventListener('scroll', handleTargetScroll, { passive: true });
  window.addEventListener('resize', queueRefresh, { passive: true });

  resizeObserver = new ResizeObserver(queueRefresh);
  resizeObserver.observe(target);
  observeTargetChildren();

  mutationObserver = new MutationObserver(() => {
    observeTargetChildren();
    queueRefresh();
  });
  mutationObserver.observe(target, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'width', 'height'],
  });

  queueRefresh();
};

watch(() => props.target, (target) => attachTarget(target));
watch(() => props.active, (active) => {
  if (active) queueRefresh();
});

onMounted(() => attachTarget(props.target));

onBeforeUnmount(() => {
  if (refreshFrame) cancelAnimationFrame(refreshFrame);
  refreshFrame = 0;
  detachTarget();
});
</script>

<template>
  <div
    v-show="hasOverflow"
    ref="trackRef"
    :data-testid="props.testId"
    class="preview-horizontal-scrollbar shrink-0 overflow-x-scroll overflow-y-hidden border-t border-border bg-header"
    role="scrollbar"
    aria-orientation="horizontal"
    :aria-label="props.label"
    :aria-valuemin="0"
    :aria-valuemax="Math.max(0, contentWidth - viewportWidth)"
    :aria-valuenow="Math.round(trackRef?.scrollLeft ?? 0)"
    @scroll="handleTrackScroll"
  >
    <div class="h-px" :style="{ width: `${contentWidth}px` }" aria-hidden="true" />
  </div>
</template>

<style scoped>
.preview-horizontal-scrollbar {
  height: 16px;
  min-height: 16px;
  scrollbar-width: auto;
  scrollbar-color: color-mix(in srgb, var(--text-color-secondary) 55%, transparent)
    color-mix(in srgb, var(--color-header) 85%, transparent);
}

.preview-horizontal-scrollbar::-webkit-scrollbar {
  height: 14px;
}

.preview-horizontal-scrollbar::-webkit-scrollbar-track {
  background: color-mix(in srgb, var(--color-header) 85%, transparent);
}

.preview-horizontal-scrollbar::-webkit-scrollbar-thumb {
  min-width: 40px;
  border: 3px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-color-secondary) 55%, transparent);
  background-clip: padding-box;
}

.preview-horizontal-scrollbar::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--text-color-secondary) 75%, transparent);
  background-clip: padding-box;
}
</style>
