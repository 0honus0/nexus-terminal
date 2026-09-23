<script setup lang="ts">
  import { computed, onBeforeUnmount, ref } from 'vue';
  import type { AgentHostSummaryDto } from '../api/agent-api';
  import { agentWindowManager } from './window-manager';

  const props = defineProps<{ summary: AgentHostSummaryDto | null; paused?: boolean }>();
  const emit = defineEmits<{ layoutChange: [] }>();

  const position = computed(() => agentWindowManager.state.launcherPosition);

  /*
   * 采用灵敏阈值拖拽（4px 判定）：
   * - 原位轻点：不触发拖拽，释放时迅速呼出 Agent Hub；
   * - 按下并移动：立即进入自由拖拽，按钮平滑跟随光标；
   * - 拖出默认位置后：弹出轻量「重置位置」气泡；右键亦可快速还原。
   */
  const DRAG_THRESHOLD_PX = 4;
  const RESET_VISIBLE_MS = 6000;

  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;
  let startRight = 0;
  let startBottom = 0;
  let resetTimer: number | null = null;
  let hasMoved = false;

  const dragging = ref(false);
  const resetVisible = ref(false);

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

  const clearResetTimer = (): void => {
    if (resetTimer !== null) window.clearTimeout(resetTimer);
    resetTimer = null;
  };

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
  };

  const pointerMove = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - originX;
    const dy = event.clientY - originY;
    if (!dragging.value) {
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        dragging.value = true;
        hasMoved = true;
        resetVisible.value = false;
      } else {
        return;
      }
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
      if (!isDefaultPosition.value) {
        clearResetTimer();
        resetVisible.value = true;
        resetTimer = window.setTimeout(() => {
          resetTimer = null;
          resetVisible.value = false;
        }, RESET_VISIBLE_MS);
      }
      return;
    }

    if (!hasMoved && !props.paused) {
      agentWindowManager.openHub({ restoreRecent: true });
    }
  };

  const cancel = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
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
    clearResetTimer();
    resetVisible.value = false;
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

  onBeforeUnmount(() => {
    clearResetTimer();
  });
</script>

<template>
  <div
    class="fixed z-30 flex items-center gap-2"
    :style="{ right: `${position.right}px`, bottom: `${position.bottom}px` }"
  >
    <!-- 拖出默认位置后的快捷还原气泡 -->
    <transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 translate-x-2 scale-90"
      enter-to-class="opacity-100 translate-x-0 scale-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 translate-x-0 scale-100"
      leave-to-class="opacity-0 translate-x-2 scale-90"
    >
      <button
        v-if="resetVisible"
        type="button"
        data-agent-launcher-reset
        class="flex h-8 items-center gap-1.5 rounded-xl border border-border/80 bg-card/90 px-3 text-xs font-medium text-text-secondary shadow-lg shadow-black/5 backdrop-blur-md transition-all hover:bg-header hover:text-foreground hover:border-border active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 cursor-pointer"
        :title="$t('agent.launcher.resetHint')"
        @click="resetPosition"
      >
        <i class="fa-solid fa-rotate-left text-[11px]" aria-hidden="true"></i>
        <span>{{ $t('agent.launcher.reset') }}</span>
      </button>
    </transition>

    <!-- 全局悬浮 Agent 呼出按钮（全新 Gen2 玻璃晶体质感） -->
    <button
      type="button"
      data-agent-launcher-trigger
      class="group relative flex h-11 w-11 touch-none select-none items-center justify-center rounded-2xl border border-primary/30 bg-gradient-to-br from-primary via-primary/95 to-primary-hover/90 text-white shadow-lg shadow-primary/25 backdrop-blur-md ring-1 ring-white/20 transition-all duration-200 hover:shadow-xl hover:shadow-primary/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 disabled:cursor-not-allowed disabled:opacity-50"
      :class="
        dragging
          ? 'scale-110 cursor-grabbing ring-2 ring-primary shadow-2xl rotate-3'
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
      <!-- 晶体顶层柔和高光 -->
      <span
        class="pointer-events-none absolute inset-x-1 top-0.5 h-3 rounded-t-xl bg-gradient-to-b from-white/25 to-transparent"
        aria-hidden="true"
      ></span>

      <!-- 核心图标 -->
      <i
        class="fa-solid fa-wand-magic-sparkles text-base transition-transform duration-200 group-hover:scale-110 group-hover:rotate-6"
        aria-hidden="true"
      ></i>

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
