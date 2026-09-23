<script setup lang="ts">
  import { computed, onBeforeUnmount, ref } from 'vue';
  import type { AgentHostSummaryDto } from '../api/agent-api';
  import { agentWindowManager } from './window-manager';

  const props = defineProps<{ summary: AgentHostSummaryDto | null; paused?: boolean }>();
  const emit = defineEmits<{ layoutChange: [] }>();

  const position = computed(() => agentWindowManager.state.launcherPosition);

  /*
   * §2.8：这个 40px 圆钮以前是"按住即拖"（6px 阈值），单击与拖动共用同一条 pointer 流程 ——
   * 想点开 Hub 的人会顺手把按钮拖走，而拖走之后除清 localStorage 外没有回到默认位置的入口。
   * 现在拆成两条路径：**长按 320ms 才进入拖动**，普通点击只负责打开；拖动结束后提供一次性的
   * 「重置位置」入口（右键还原作为兜底），默认位置由 window-manager 持有。
   */
  const HOLD_MS = 320;
  const MOVE_CANCEL_PX = 10;
  const RESET_VISIBLE_MS = 7000;

  let pointerId: number | null = null;
  let holdTimer: number | null = null;
  let resetTimer: number | null = null;
  let originX = 0;
  let originY = 0;
  let startRight = 0;
  let startBottom = 0;
  let moved = false;

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

  const clearHoldTimer = (): void => {
    if (holdTimer !== null) window.clearTimeout(holdTimer);
    holdTimer = null;
  };
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
    moved = false;
    resetVisible.value = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    clearHoldTimer();
    holdTimer = window.setTimeout(() => {
      holdTimer = null;
      dragging.value = true;
    }, HOLD_MS);
  };

  const pointerMove = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - originX;
    const dy = event.clientY - originY;
    if (!dragging.value) {
      // Before the long press completes this gesture is still a click: give up on it instead of
      // dragging the button, which is exactly the accidental-move complaint in §2.8.
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        moved = true;
        clearHoldTimer();
      }
      return;
    }
    moved = true;
    agentWindowManager.setLauncherPosition(clamp(startRight - dx, startBottom - dy));
  };

  const finish = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    pointerId = null;
    clearHoldTimer();
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
    if (moved) return;
    if (!props.paused) agentWindowManager.openHub({ restoreRecent: true });
  };

  const cancel = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    clearHoldTimer();
    dragging.value = false;
    moved = true;
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
    clearHoldTimer();
    clearResetTimer();
  });
</script>

<template>
  <div
    class="fixed z-30 flex items-center gap-2"
    :style="{ right: `${position.right}px`, bottom: `${position.bottom}px` }"
  >
    <button
      v-if="resetVisible"
      type="button"
      data-agent-launcher-reset
      class="flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-card/95 px-2.5 text-[11px] font-medium text-text-secondary shadow-sm backdrop-blur transition-colors hover:bg-header hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
      :title="$t('agent.launcher.resetHint')"
      @click="resetPosition"
    >
      <i class="fa-solid fa-rotate-left text-[10px]" aria-hidden="true"></i>
      <span>{{ $t('agent.launcher.reset') }}</span>
    </button>
    <button
      type="button"
      data-agent-launcher-trigger
      class="relative flex h-10 w-10 touch-none select-none items-center justify-center rounded-full border border-primary/45 bg-primary text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
      :class="dragging ? 'scale-110 cursor-grabbing ring-2 ring-primary/40' : 'cursor-pointer hover:scale-105'"
      :aria-label="$t('agent.launcher.open')"
      :title="`${$t('agent.launcher.open')} · ${$t('agent.launcher.dragHint')}`"
      :disabled="paused"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="finish"
      @pointercancel="cancel"
      @contextmenu="onContextMenu"
      @keydown="keydown"
    >
      <i class="fa-solid fa-wand-magic-sparkles text-sm" aria-hidden="true"></i>
      <span
        v-if="badge > 0"
        class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[9px] font-bold leading-none text-white shadow-xs"
      >
        {{ badge > 99 ? '99+' : badge }}
      </span>
    </button>
  </div>
</template>
