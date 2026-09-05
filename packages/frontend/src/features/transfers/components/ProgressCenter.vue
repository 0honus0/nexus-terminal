<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BasePanel } from '@/foundation/ui';
  import { useDraggablePosition, useResizeHandle } from '@/foundation/interaction';
  import type { TransferTask } from '../model/transfer';

  const STORAGE_KEY = 'nexus.transfer-progress-window';
  const MIN_WIDTH = 340;
  const MIN_HEIGHT = 190;

  const props = defineProps<{ tasks: TransferTask[] }>();
  const emit = defineEmits<{ cancel: [id: string]; cancelAll: []; remove: [id: string]; hide: [] }>();
  const { t } = useI18n();
  const panel = ref<HTMLElement | null>(null);
  const width = ref(416);
  const height = ref(320);
  const position = ref({ x: 16, y: 16 });
  const initialized = ref(false);
  const aggregateSpeed = ref(0);
  let speedTimer: number | undefined;
  let lastSpeedSampleAt = 0;
  let lastBytesWritten = 0;

  const availableWidth = (): number => Math.max(1, window.innerWidth - 16);
  const availableHeight = (): number => Math.max(1, window.innerHeight - 16);
  const responsiveMinWidth = (): number => Math.min(MIN_WIDTH, availableWidth());
  const responsiveMinHeight = (): number => Math.min(MIN_HEIGHT, availableHeight());

  const sorted = computed(() => [...props.tasks].sort((a, b) => b.createdAt - a.createdAt));
  const done = (status: string) => ['completed', 'cancelled', 'skipped', 'partial', 'error'].includes(status);
  const totalBytesWritten = () => props.tasks.reduce((sum, task) => sum + Math.max(0, task.bytesWritten), 0);
  const sampleAggregateSpeed = (): void => {
    const now = performance.now();
    const bytes = totalBytesWritten();
    if (!lastSpeedSampleAt) {
      lastSpeedSampleAt = now;
      lastBytesWritten = bytes;
      aggregateSpeed.value = 0;
      return;
    }
    const elapsedSeconds = (now - lastSpeedSampleAt) / 1000;
    const deltaBytes = bytes - lastBytesWritten;
    aggregateSpeed.value = elapsedSeconds > 0 && deltaBytes >= 0 ? deltaBytes / elapsedSeconds : 0;
    lastSpeedSampleAt = now;
    lastBytesWritten = bytes;
  };
  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond >= 1024 ** 2) return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`;
    if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${Math.round(bytesPerSecond)} B/s`;
  };

  const clampWindow = (): void => {
    width.value = Math.min(Math.max(responsiveMinWidth(), width.value), availableWidth());
    height.value = Math.min(Math.max(responsiveMinHeight(), height.value), availableHeight());
    position.value = {
      x: Math.max(8, Math.min(position.value.x, window.innerWidth - width.value - 8)),
      y: Math.max(8, Math.min(position.value.y, window.innerHeight - height.value - 8)),
    };
  };

  const saveWindow = (): void => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ width: width.value, height: height.value, x: position.value.x, y: position.value.y }),
      );
    } catch {
      // Window state can remain in memory when storage is unavailable.
    }
  };

  const restoreWindow = (): void => {
    let restored = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<{ width: number; height: number; x: number; y: number }>;
        if ([saved.width, saved.height, saved.x, saved.y].every((value) => Number.isFinite(value))) {
          width.value = saved.width!;
          height.value = saved.height!;
          position.value = { x: saved.x!, y: saved.y! };
          restored = true;
        }
      }
    } catch {
      // Ignore malformed storage.
    }

    if (!restored) {
      width.value = Math.min(416, availableWidth());
      height.value = Math.min(320, availableHeight());
      position.value = {
        x: 16,
        y: Math.max(8, window.innerHeight - height.value - 16),
      };
    }
    clampWindow();
    initialized.value = true;
  };

  const drag = useDraggablePosition({
    position,
    getElement: () => panel.value,
    canStart: (event) => !(event.target as HTMLElement).closest('button'),
    constrain: (candidate, element) => ({
      x: Math.max(8, Math.min(candidate.x, window.innerWidth - element.offsetWidth - 8)),
      y: Math.max(8, Math.min(candidate.y, window.innerHeight - element.offsetHeight - 8)),
    }),
    onEnd: saveWindow,
  });

  const resize = useResizeHandle({
    width,
    height,
    minWidth: responsiveMinWidth,
    minHeight: responsiveMinHeight,
    maxWidth: availableWidth,
    maxHeight: availableHeight,
    onMove: clampWindow,
    onEnd: saveWindow,
  });

  onMounted(() => {
    restoreWindow();
    sampleAggregateSpeed();
    speedTimer = window.setInterval(sampleAggregateSpeed, 500);
    window.addEventListener('resize', clampWindow);
  });
  onBeforeUnmount(() => {
    if (speedTimer !== undefined) window.clearInterval(speedTimer);
    window.removeEventListener('resize', clampWindow);
  });
</script>

<template>
  <BasePanel
    v-show="initialized"
    ref="panel"
    data-testid="transfer-progress-center"
    padding="none"
    class="fixed z-40 flex min-h-0 flex-col overflow-hidden shadow-xl"
    :class="[drag.dragging.value ? 'select-none' : '', resize.isResizing.value ? 'select-none' : '']"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
      width: `${width}px`,
      height: `${height}px`,
    }"
  >
    <header
      class="flex shrink-0 cursor-grab items-center justify-between gap-2 border-b border-border bg-header/80 px-3 py-2 active:cursor-grabbing"
      @pointerdown="drag.startDragging"
    >
      <h3 class="font-semibold">{{ t('progressCenter.title') }}</h3>
      <div class="flex items-center gap-1">
        <span data-testid="transfer-progress-speed" class="text-xs text-text-secondary"
          >{{ t('progressCenter.speed') }}: {{ formatSpeed(aggregateSpeed) }}</span
        >
        <span class="text-xs text-text-secondary">{{ tasks.length }}</span>
        <BaseButton
          v-if="tasks.some((task) => !done(task.status))"
          data-testid="transfer-progress-cancel-all"
          size="sm"
          variant="ghost"
          @click="emit('cancelAll')"
        >
          {{ t('progressCenter.cancelAll') }}
        </BaseButton>
        <BaseButton data-testid="transfer-progress-hide" size="sm" variant="ghost" @click="emit('hide')">{{
          t('progressCenter.hide')
        }}</BaseButton>
      </div>
    </header>

    <p v-if="!sorted.length" class="py-4 text-center text-sm text-text-secondary">{{ t('progressCenter.empty') }}</p>
    <ul v-else class="min-h-0 flex-1 space-y-2 overflow-auto p-2">
      <li
        v-for="task in sorted"
        :key="task.id"
        data-testid="transfer-progress-task"
        :data-task-id="task.id"
        :data-task-kind="task.kind"
        :data-task-status="task.status"
        class="rounded border border-border p-2"
      >
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ task.label }}</span>
          <span class="text-xs text-text-secondary">{{ t(`progressCenter.kind.${task.kind}`) }}</span>
        </div>
        <div data-testid="transfer-progress-bar" class="mt-2 h-1.5 overflow-hidden rounded bg-header">
          <div class="h-full bg-primary" :style="{ width: `${Math.max(0, Math.min(100, task.progress))}%` }"></div>
        </div>
        <div class="mt-1 flex items-center justify-between gap-2 text-xs text-text-secondary">
          <span>{{ t(`progressCenter.status.${task.status}`) }} · {{ Math.round(task.progress) }}%</span>
          <div class="flex gap-1">
            <BaseButton
              v-if="!done(task.status)"
              data-testid="transfer-progress-cancel"
              size="sm"
              @click="emit('cancel', task.id)"
            >
              {{ t('common.cancel') }}
            </BaseButton>
            <BaseButton v-else size="sm" variant="ghost" @click="emit('remove', task.id)">×</BaseButton>
          </div>
        </div>
        <p v-if="task.warning" class="mt-1 text-xs text-warning">{{ task.warning }}</p>
        <p v-if="task.error" class="mt-1 text-xs text-error">{{ task.error }}</p>
      </li>
    </ul>

    <button
      type="button"
      data-testid="transfer-progress-resize"
      class="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
      :title="t('progressCenter.resize')"
      :aria-label="t('progressCenter.resize')"
      @pointerdown.stop="resize.startResize"
    ></button>
  </BasePanel>
</template>
