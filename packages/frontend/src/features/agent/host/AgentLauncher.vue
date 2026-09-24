<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import type { AgentHostSummaryDto } from '../api/agent-api';
  import { agentWindowManager } from './window-manager';

  const props = defineProps<{ summary: AgentHostSummaryDto | null; paused?: boolean }>();
  const emit = defineEmits<{ layoutChange: [] }>();

  const position = computed(() => agentWindowManager.state.launcherPosition);

  const LONG_PRESS_MS = 320;
  const DRAG_SLOP_PX = 6;

  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;
  let startRight = 0;
  let startBottom = 0;
  let hasMoved = false;
  let dragTimer: ReturnType<typeof setTimeout> | null = null;

  const dragging = ref(false);

  const clearDragTimer = (): void => {
    if (dragTimer === null) return;
    clearTimeout(dragTimer);
    dragTimer = null;
  };

  const badge = computed(() => {
    const summary = props.summary;
    if (!summary) return 0;
    return summary.totalRunningRuns + summary.totalPendingApprovals + summary.totalPendingBudgetRequests;
  });

  const isDefaultPosition = computed(
    () =>
      position.value.right === agentWindowManager.defaultLauncherPosition.right &&
      position.value.bottom === agentWindowManager.defaultLauncherPosition.bottom,
  );

  const clamp = (right: number, bottom: number) => ({
    right: Math.max(12, Math.min(right, Math.max(12, window.innerWidth - 72))),
    bottom: Math.max(12, Math.min(bottom, Math.max(12, window.innerHeight - 72))),
  });

  const pointerDown = (event: PointerEvent) => {
    if (props.paused || event.button !== 0) return;
    pointerId = event.pointerId;
    originX = event.clientX;
    originY = event.clientY;
    startRight = position.value.right;
    startBottom = position.value.bottom;
    hasMoved = false;
    dragging.value = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    clearDragTimer();
    dragTimer = setTimeout(() => {
      dragTimer = null;
      if (pointerId !== event.pointerId || hasMoved || props.paused) return;
      dragging.value = true;
      hasMoved = true;
    }, LONG_PRESS_MS);
  };

  const pointerMove = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - originX;
    const dy = event.clientY - originY;
    if (!dragging.value) {
      if (Math.hypot(dx, dy) >= DRAG_SLOP_PX) {
        hasMoved = true;
        clearDragTimer();
      }
      return;
    }
    hasMoved = true;
    agentWindowManager.setLauncherPosition(clamp(startRight - dx, startBottom - dy));
  };

  const handleClick = () => {
    if (hasMoved || dragging.value || props.paused) return;
    agentWindowManager.openHub({ restoreRecent: true });
  };

  const finish = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    clearDragTimer();
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // pointer capture already released
      }
    }
    pointerId = null;
    const wasDragging = dragging.value;
    dragging.value = false;

    if (wasDragging) {
      emit('layoutChange');
    }
  };

  const cancel = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    clearDragTimer();
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // pointer capture already released
      }
    }
    pointerId = null;
    dragging.value = false;
    hasMoved = true;
  };

  const resetPosition = (): void => {
    if (isDefaultPosition.value) return;
    agentWindowManager.resetLauncherPosition();
    emit('layoutChange');
  };

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    resetPosition();
  };

  const keydown = (event: KeyboardEvent) => {
    if (props.paused || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    agentWindowManager.openHub({ restoreRecent: true });
  };

  const handleViewportResize = (): void => {
    agentWindowManager.clampLauncherPosition();
  };

  onMounted(() => {
    agentWindowManager.clampLauncherPosition();
    window.addEventListener('resize', handleViewportResize);
  });

  onBeforeUnmount(() => {
    clearDragTimer();
    window.removeEventListener('resize', handleViewportResize);
  });
</script>

<template>
  <div class="fixed z-30 flex items-center" :style="{ right: `${position.right}px`, bottom: `${position.bottom}px` }">
    <!-- 全局悬浮 Agent 呼出按钮（圆形微质感中性毛玻璃，非通体紫色，精致 AI 星芒矢量图标） -->
    <button
      type="button"
      data-agent-launcher-trigger
      class="group relative flex h-11 w-11 touch-none select-none items-center justify-center rounded-full border border-border/80 bg-card/92 text-foreground shadow-[0_4px_20px_rgba(0,0,0,0.12)] backdrop-blur-xl ring-1 ring-white/20 dark:ring-white/8 transition-all duration-200 hover:border-primary/50 hover:shadow-[0_6px_24px_color-mix(in_srgb,var(--color-primary)_22%,transparent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 disabled:cursor-not-allowed disabled:opacity-50"
      :class="
        dragging
          ? 'scale-110 cursor-grabbing ring-2 ring-primary/60 shadow-2xl rotate-3'
          : 'cursor-pointer hover:scale-105 active:scale-95'
      "
      :aria-label="$t('agent.launcher.open')"
      :title="`${$t('agent.launcher.open')} · ${$t('agent.launcher.dragHint')}`"
      :disabled="paused"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="finish"
      @pointercancel="cancel"
      @click="handleClick"
      @contextmenu="onContextMenu"
      @keydown="keydown"
    >
      <!-- 内部微弱径向漫射光晕 -->
      <span
        class="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_35%,color-mix(in_srgb,var(--color-primary)_12%,transparent)_0%,transparent_70%)] opacity-80 group-hover:opacity-100 transition-opacity"
        aria-hidden="true"
      ></span>
      <!-- 顶层晶体微弧光切面 -->
      <span
        class="pointer-events-none absolute inset-x-2.5 top-0.5 h-2 rounded-t-full bg-gradient-to-b from-white/35 dark:from-white/15 to-transparent"
        aria-hidden="true"
      ></span>

      <!-- 核心图标：高精度精致 AI 智能星芒（告别粗硬魔法棒，呈现极具未来感的晶体微光） -->
      <div class="relative flex items-center justify-center pointer-events-none">
        <span
          class="absolute inset-0 rounded-full bg-primary/20 blur-[5px] transition-all duration-300 group-hover:bg-primary/35 group-hover:blur-[7px]"
          aria-hidden="true"
        ></span>
        <svg
          class="relative h-5 w-5 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="nexus-agent-launcher-core-grad"
              x1="2"
              y1="2"
              x2="20"
              y2="21"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stop-color="var(--color-primary, #a855f7)" />
              <stop offset="100%" stop-color="#38bdf8" />
            </linearGradient>
            <linearGradient
              id="nexus-agent-launcher-sparkle-grad"
              x1="14"
              y1="2"
              x2="22"
              y2="10"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stop-color="#38bdf8" />
              <stop offset="100%" stop-color="var(--color-primary, #a855f7)" />
            </linearGradient>
          </defs>
          <path
            d="M10 2.5C10 7.47 5.97 11.5 1 11.5C5.97 11.5 10 15.53 10 20.5C10 15.53 14.03 11.5 19 11.5C14.03 11.5 10 7.47 10 2.5Z"
            fill="url(#nexus-agent-launcher-core-grad)"
          />
          <path
            d="M18.5 2.5C18.5 4.71 16.71 6.5 14.5 6.5C16.71 6.5 18.5 8.29 18.5 10.5C18.5 8.29 20.29 6.5 22.5 6.5C20.29 6.5 18.5 4.71 18.5 2.5Z"
            fill="url(#nexus-agent-launcher-sparkle-grad)"
          />
          <circle cx="4.5" cy="18.5" r="1.1" fill="#38bdf8" opacity="0.85" />
        </svg>
      </div>

      <!-- 状态与任务数字指示徽标 -->
      <span
        v-if="badge > 0"
        class="absolute -right-1 -top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold leading-none text-white shadow-xs ring-2 ring-background"
      >
        {{ badge > 99 ? '99+' : badge }}
      </span>
    </button>
  </div>
</template>
