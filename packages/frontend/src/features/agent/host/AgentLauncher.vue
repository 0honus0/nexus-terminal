<script setup lang="ts">
  import { computed } from 'vue';
  import type { HostSummaryView } from '../api/agent-api';
  import { agentWindowManager } from './window-manager';

  const props = defineProps<{ summary: HostSummaryView | null; paused?: boolean }>();

  const position = computed(() => agentWindowManager.state.launcherPosition);
  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;
  let startRight = 0;
  let startBottom = 0;
  let moved = false;

  const badge = computed(() => {
    const summary = props.summary;
    if (!summary) return 0;
    return summary.totalRunningRuns + summary.totalPendingApprovals + summary.totalPendingBudgetRequests;
  });

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
    moved = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - originX;
    const dy = event.clientY - originY;
    if (Math.hypot(dx, dy) >= 6) moved = true;
    if (!moved) return;
    agentWindowManager.setLauncherPosition(clamp(startRight - dx, startBottom - dy));
  };

  const finish = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    pointerId = null;
    if (!moved && !props.paused) agentWindowManager.openHub({ restoreRecent: true });
  };

  const cancel = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    moved = true;
  };

  const keydown = (event: KeyboardEvent) => {
    if (props.paused || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    agentWindowManager.openHub({ restoreRecent: true });
  };
</script>

<template>
  <button
    type="button"
    class="fixed z-30 flex h-14 w-14 touch-none select-none items-center justify-center rounded-full border border-primary/40 bg-primary text-xl text-white shadow-xl transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
    :style="{ right: `${position.right}px`, bottom: `${position.bottom}px` }"
    :aria-label="$t('agent.launcher.open')"
    :title="$t('agent.launcher.open')"
    :disabled="paused"
    @pointerdown="pointerDown"
    @pointermove="pointerMove"
    @pointerup="finish"
    @pointercancel="cancel"
    @keydown="keydown"
  >
    <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
    <span
      v-if="badge > 0"
      class="absolute -right-1 -top-1 min-w-5 rounded-full bg-error px-1.5 py-0.5 text-center text-[10px] font-bold leading-4 text-white"
    >
      {{ badge > 99 ? '99+' : badge }}
    </span>
  </button>
</template>
