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
let previousTouchAction = '';
let previousOverscrollBehaviorX = '';
let touchGesture: {
  identifier: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  horizontalPanActive: boolean;
} | null = null;

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

const findGestureTouch = (event: TouchEvent): Touch | null => {
  if (!touchGesture) return null;
  for (const touch of Array.from(event.touches)) {
    if (touch.identifier === touchGesture.identifier) return touch;
  }
  return null;
};

const handleTargetTouchStart = (event: TouchEvent) => {
  if (!observedTarget || event.touches.length !== 1) {
    touchGesture = null;
    return;
  }

  const touch = event.touches[0];
  touchGesture = {
    identifier: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
    startScrollLeft: observedTarget.scrollLeft,
    startScrollTop: observedTarget.scrollTop,
    horizontalPanActive: false,
  };
};

const handleTargetTouchMove = (event: TouchEvent) => {
  if (!observedTarget || !touchGesture) return;
  const touch = findGestureTouch(event);
  if (!touch) return;

  const deltaX = touch.clientX - touchGesture.startX;
  const deltaY = touch.clientY - touchGesture.startY;
  if (!touchGesture.horizontalPanActive) {
    if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return;
    if (Math.abs(deltaX) <= Math.abs(deltaY)) return;
    if (observedTarget.scrollWidth <= observedTarget.clientWidth + 1) return;
    touchGesture.horizontalPanActive = true;
  }

  // The preview content deliberately hides its native horizontal scrollbar on
  // desktop. On touch devices that also removes the browser's horizontal pan
  // affordance, so mirror the finger movement into the real scroll target.
  event.preventDefault();
  observedTarget.scrollLeft = touchGesture.startScrollLeft - deltaX;
  observedTarget.scrollTop = touchGesture.startScrollTop - deltaY;
  syncTrackFromTarget();
};

const clearTargetTouchGesture = () => {
  touchGesture = null;
};

const observeTargetChildren = () => {
  if (!resizeObserver || !observedTarget) return;
  for (const child of Array.from(observedTarget.children)) resizeObserver.observe(child);
};

const detachTarget = () => {
  observedTarget?.removeEventListener('scroll', handleTargetScroll);
  observedTarget?.removeEventListener('touchstart', handleTargetTouchStart);
  observedTarget?.removeEventListener('touchmove', handleTargetTouchMove);
  observedTarget?.removeEventListener('touchend', clearTargetTouchGesture);
  observedTarget?.removeEventListener('touchcancel', clearTargetTouchGesture);
  if (observedTarget) {
    observedTarget.style.touchAction = previousTouchAction;
    observedTarget.style.overscrollBehaviorX = previousOverscrollBehaviorX;
  }
  window.removeEventListener('resize', queueRefresh);
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  resizeObserver = null;
  mutationObserver = null;
  touchGesture = null;
  observedTarget = null;
};

const attachTarget = (target: HTMLElement | null) => {
  detachTarget();
  observedTarget = target;
  if (!target) {
    refreshMetrics();
    return;
  }

  previousTouchAction = target.style.touchAction;
  previousOverscrollBehaviorX = target.style.overscrollBehaviorX;
  target.style.touchAction = 'pan-y';
  target.style.overscrollBehaviorX = 'contain';
  target.addEventListener('scroll', handleTargetScroll, { passive: true });
  target.addEventListener('touchstart', handleTargetTouchStart, { passive: true });
  target.addEventListener('touchmove', handleTargetTouchMove, { passive: false });
  target.addEventListener('touchend', clearTargetTouchGesture, { passive: true });
  target.addEventListener('touchcancel', clearTargetTouchGesture, { passive: true });
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
