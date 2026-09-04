<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

  const props = withDefaults(defineProps<{ target: HTMLElement | null; label?: string; active?: boolean }>(), {
    label: 'Horizontal scroll',
    active: true,
  });
  const track = ref<HTMLElement | null>(null);
  const contentWidth = ref(0);
  const viewportWidth = ref(0);
  const hasOverflow = computed(() => contentWidth.value > viewportWidth.value + 1);
  let observed: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let frame = 0;
  let previousTouchAction = '';
  let previousOverscrollX = '';
  let touchGesture: {
    identifier: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
    horizontal: boolean;
  } | null = null;

  const syncTrack = () => {
    if (!observed || !track.value || Math.abs(track.value.scrollLeft - observed.scrollLeft) <= 1) return;
    track.value.scrollLeft = observed.scrollLeft;
  };
  const refresh = () => {
    frame = 0;
    viewportWidth.value = observed?.clientWidth ?? 0;
    contentWidth.value = observed ? Math.max(observed.clientWidth, observed.scrollWidth) : 0;
    syncTrack();
  };
  const queueRefresh = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refresh);
  };
  const handleTrackScroll = () => {
    if (!observed || !track.value || Math.abs(observed.scrollLeft - track.value.scrollLeft) <= 1) return;
    observed.scrollLeft = track.value.scrollLeft;
  };
  const gestureTouch = (event: TouchEvent): Touch | null => {
    if (!touchGesture) return null;
    return Array.from(event.touches).find((touch) => touch.identifier === touchGesture!.identifier) ?? null;
  };
  const handleTouchStart = (event: TouchEvent) => {
    if (!observed || event.touches.length !== 1) {
      touchGesture = null;
      return;
    }
    const touch = event.touches[0]!;
    touchGesture = {
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      startScrollLeft: observed.scrollLeft,
      startScrollTop: observed.scrollTop,
      horizontal: false,
    };
  };
  const handleTouchMove = (event: TouchEvent) => {
    if (!observed || !touchGesture) return;
    const touch = gestureTouch(event);
    if (!touch) return;
    const dx = touch.clientX - touchGesture.startX;
    const dy = touch.clientY - touchGesture.startY;
    if (!touchGesture.horizontal) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dx) <= Math.abs(dy) || observed.scrollWidth <= observed.clientWidth + 1) return;
      touchGesture.horizontal = true;
    }
    event.preventDefault();
    observed.scrollLeft = touchGesture.startScrollLeft - dx;
    observed.scrollTop = touchGesture.startScrollTop - dy;
    syncTrack();
  };
  const clearGesture = () => {
    touchGesture = null;
  };
  const observeChildren = () => {
    if (!resizeObserver || !observed) return;
    for (const child of Array.from(observed.children)) resizeObserver.observe(child);
  };
  const detach = () => {
    observed?.removeEventListener('scroll', syncTrack);
    observed?.removeEventListener('touchstart', handleTouchStart);
    observed?.removeEventListener('touchmove', handleTouchMove);
    observed?.removeEventListener('touchend', clearGesture);
    observed?.removeEventListener('touchcancel', clearGesture);
    if (observed) {
      observed.style.touchAction = previousTouchAction;
      observed.style.overscrollBehaviorX = previousOverscrollX;
    }
    window.removeEventListener('resize', queueRefresh);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = null;
    mutationObserver = null;
    observed = null;
    touchGesture = null;
  };
  const attach = (target: HTMLElement | null) => {
    detach();
    observed = target;
    if (!target) {
      refresh();
      return;
    }
    previousTouchAction = target.style.touchAction;
    previousOverscrollX = target.style.overscrollBehaviorX;
    target.style.touchAction = 'pan-y';
    target.style.overscrollBehaviorX = 'contain';
    target.addEventListener('scroll', syncTrack, { passive: true });
    target.addEventListener('touchstart', handleTouchStart, { passive: true });
    target.addEventListener('touchmove', handleTouchMove, { passive: false });
    target.addEventListener('touchend', clearGesture, { passive: true });
    target.addEventListener('touchcancel', clearGesture, { passive: true });
    window.addEventListener('resize', queueRefresh, { passive: true });
    resizeObserver = new ResizeObserver(queueRefresh);
    resizeObserver.observe(target);
    observeChildren();
    mutationObserver = new MutationObserver(() => {
      observeChildren();
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

  watch(() => props.target, attach);
  watch(
    () => props.active,
    (active) => {
      if (active) queueRefresh();
    },
  );
  onMounted(() => attach(props.target));
  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame);
    detach();
  });
</script>

<template>
  <div
    v-show="hasOverflow"
    ref="track"
    class="preview-horizontal-scrollbar shrink-0 overflow-x-scroll overflow-y-hidden border-t border-border bg-header"
    role="scrollbar"
    aria-orientation="horizontal"
    :aria-label="label"
    :aria-valuemin="0"
    :aria-valuemax="Math.max(0, contentWidth - viewportWidth)"
    :aria-valuenow="Math.round(track?.scrollLeft ?? 0)"
    @scroll="handleTrackScroll"
  >
    <div class="h-px" :style="{ width: `${contentWidth}px` }" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
  .preview-horizontal-scrollbar {
    height: 16px;
    min-height: 16px;
    scrollbar-width: auto;
  }
  .preview-horizontal-scrollbar::-webkit-scrollbar {
    height: 14px;
  }
  @media (hover: none) and (pointer: coarse) {
    .preview-horizontal-scrollbar {
      display: none !important;
    }
  }
</style>
