<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useDraggablePosition, useResizeHandle } from '@/foundation/interaction';
  import type { TransferTask } from '../model/transfer';

  const STORAGE_KEY = 'nexus.transfer-progress-window';
  const MIN_WIDTH = 340;
  const MIN_HEIGHT = 190;

  const props = defineProps<{ tasks: TransferTask[] }>();
  const emit = defineEmits<{ cancel: [id: string]; cancelAll: []; remove: [id: string]; hide: [] }>();
  const { t } = useI18n();
  const panel = ref<HTMLElement | null>(null);
  const width = ref(440);
  const height = ref(300);
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
  const activeTasks = computed(() => sorted.value.filter((task) => !done(task.status)));
  const presentationMode = computed<'upload' | 'archive' | 'transfer' | 'mixed'>(() => {
    if (sorted.value.length && sorted.value.every((task) => task.kind === 'upload')) return 'upload';
    if (sorted.value.length && sorted.value.every((task) => task.kind === 'compress' || task.kind === 'decompress'))
      return 'archive';
    if (sorted.value.length && sorted.value.every((task) => ['copy', 'move', 'transfer'].includes(task.kind)))
      return 'transfer';
    return 'mixed';
  });
  const formatBytes = (bytes: number): string => {
    const value = Math.max(0, bytes);
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${Math.round(value)} B`;
  };
  const currentFilename = (task: TransferTask): string => {
    const value = task.currentFile || task.label;
    return value.split(/[\/]/).filter(Boolean).at(-1) || value;
  };
  const archiveLabel = (task: TransferTask): string => t(`progressCenter.kind.${task.kind}`);
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
      width.value = Math.min(440, availableWidth());
      height.value = Math.min(300, availableHeight());
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
  <div
    v-show="initialized"
    ref="panel"
    data-testid="transfer-progress-center"
    class="transfer-progress-window fixed z-40 flex min-h-0 flex-col overflow-hidden border border-border bg-background text-sm shadow-xl"
    :class="[
      `transfer-progress-window--${presentationMode}`,
      drag.dragging.value ? 'dragging select-none' : '',
      resize.isResizing.value ? 'resizing select-none' : '',
    ]"
    :style="{ left: `${position.x}px`, top: `${position.y}px`, width: `${width}px`, height: `${height}px` }"
  >
    <header class="transfer-progress-header shrink-0" @pointerdown="drag.startDragging">
      <template v-if="presentationMode === 'upload'">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <h4 class="m-0 min-w-0 flex-1 truncate text-sm font-semibold">{{ t('fileManager.uploadTasks') }}</h4>
          <span
            v-if="activeTasks.length"
            data-testid="transfer-progress-speed"
            class="shrink-0 whitespace-nowrap rounded-md bg-black/5 px-2 py-1 text-xs tabular-nums text-text-secondary dark:bg-white/5"
          >
            {{ t('fileManager.uploadSpeed') }} {{ formatSpeed(aggregateSpeed) }}
          </span>
          <button
            type="button"
            data-testid="transfer-progress-hide"
            class="progress-icon-button h-7 w-7"
            :title="t('progressCenter.hide')"
            :aria-label="t('progressCenter.hide')"
            @click="emit('hide')"
          >
            <i class="fas fa-minus" aria-hidden="true"></i>
          </button>
          <button
            v-if="activeTasks.length > 1"
            type="button"
            data-testid="transfer-progress-cancel-all"
            class="shrink-0 rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:bg-red-950/30 dark:text-red-300"
            @click="emit('cancelAll')"
          >
            {{ t('fileManager.actions.cancelAll') }} ({{ activeTasks.length }})
          </button>
        </div>
      </template>

      <template v-else-if="presentationMode === 'archive'">
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <span class="archive-icon"><i class="fas fa-box-archive" aria-hidden="true"></i></span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold">
              {{ sorted[0] ? archiveLabel(sorted[0]) : t('progressCenter.title') }}
            </div>
            <div class="text-[11px] text-text-secondary">{{ t('progressCenter.running') }}</div>
          </div>
          <span v-if="sorted[0]" class="archive-percent">{{ Math.round(sorted[0].progress) }}%</span>
          <button
            type="button"
            data-testid="transfer-progress-hide"
            class="progress-icon-button h-7 w-7"
            :title="t('progressCenter.hide')"
            :aria-label="t('progressCenter.hide')"
            @click="emit('hide')"
          >
            <i class="fas fa-minus" aria-hidden="true"></i>
          </button>
        </div>
      </template>

      <template v-else>
        <h4 class="m-0 min-w-0 flex-1 truncate text-sm font-semibold">
          {{ presentationMode === 'transfer' ? t('fileManager.transferTasks') : t('progressCenter.title') }}
        </h4>
        <div class="flex items-center gap-2">
          <span
            v-if="activeTasks.length"
            data-testid="transfer-progress-speed"
            class="whitespace-nowrap text-xs tabular-nums text-text-secondary"
          >
            {{ t('fileManager.transferSpeed') }} {{ formatSpeed(aggregateSpeed) }}
          </span>
          <button
            v-if="activeTasks.length > 1"
            type="button"
            data-testid="transfer-progress-cancel-all"
            class="rounded px-2 py-1 text-xs text-error hover:bg-error/10"
            @click="emit('cancelAll')"
          >
            {{ t('progressCenter.cancelAll') }}
          </button>
          <button
            type="button"
            data-testid="transfer-progress-hide"
            class="progress-icon-button h-6 w-6"
            :title="t('progressCenter.hide')"
            :aria-label="t('progressCenter.hide')"
            @click="emit('hide')"
          >
            <i class="fas fa-minus" aria-hidden="true"></i>
          </button>
        </div>
      </template>
    </header>

    <p v-if="!sorted.length" class="py-4 text-center text-sm text-text-secondary">{{ t('progressCenter.empty') }}</p>

    <ul
      v-else-if="presentationMode === 'upload'"
      class="progress-scrollbar m-0 min-h-0 flex-1 list-none overflow-y-auto p-3"
    >
      <li
        v-for="task in sorted"
        :key="task.id"
        data-testid="transfer-progress-task"
        :data-task-id="task.id"
        :data-task-kind="task.kind"
        :data-task-status="task.status"
        class="upload-task-row mb-1.5 text-xs last:mb-0"
      >
        <span class="min-w-0 truncate" :title="task.label"
          >{{ task.label }} ({{ t(`progressCenter.status.${task.status}`) }})</span
        >
        <div class="min-w-0">
          <progress
            v-if="!done(task.status)"
            data-testid="transfer-progress-bar"
            :value="task.progress"
            max="100"
            class="legacy-progress block h-2 w-full"
          ></progress>
        </div>
        <span class="text-right text-xs tabular-nums text-text-secondary">{{
          !done(task.status) ? `${Math.round(task.progress)}%` : '—'
        }}</span>
        <button
          v-if="!done(task.status)"
          type="button"
          data-testid="transfer-progress-cancel"
          class="justify-self-end rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs text-red-700 hover:bg-red-200"
          @click="emit('cancel', task.id)"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          v-else
          type="button"
          class="justify-self-end rounded px-1.5 py-0.5 text-text-secondary hover:bg-border/60"
          :aria-label="t('common.remove')"
          @click="emit('remove', task.id)"
        >
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
        <span v-if="task.error" class="col-span-4 text-xs text-error">{{ task.error }}</span>
        <span v-else-if="task.warning" class="col-span-4 text-xs text-warning">{{ task.warning }}</span>
      </li>
    </ul>

    <ul
      v-else-if="presentationMode === 'archive'"
      class="progress-scrollbar m-0 min-h-0 flex-1 list-none overflow-y-auto"
    >
      <li
        v-for="task in sorted"
        :key="task.id"
        data-testid="transfer-progress-task"
        :data-task-id="task.id"
        :data-task-kind="task.kind"
        :data-task-status="task.status"
        class="archive-progress-body"
      >
        <div class="space-y-1.5">
          <div class="flex items-center justify-between gap-4 text-xs">
            <span>{{ t('fileManager.archiveProgress.filesProcessed', { count: task.completedFiles }) }}</span>
            <span v-if="task.totalFiles !== null" class="font-mono text-text-secondary"
              >{{ task.completedFiles }}/{{ task.totalFiles }}</span
            >
          </div>
          <div
            data-testid="transfer-progress-bar"
            class="archive-progress-track"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="Math.round(task.progress)"
          >
            <div
              class="archive-progress-value"
              :style="{ transform: `scaleX(${Math.max(0, Math.min(100, task.progress)) / 100})` }"
            ></div>
          </div>
        </div>
        <div v-if="task.currentFile" class="archive-current-file" :title="task.currentFile">
          <i class="far fa-file-lines" aria-hidden="true"></i><span class="truncate">{{ currentFilename(task) }}</span>
        </div>
        <button
          v-if="!done(task.status)"
          type="button"
          data-testid="transfer-progress-cancel"
          class="archive-stop-button"
          :disabled="task.status === 'cancelling'"
          @click="emit('cancel', task.id)"
        >
          <i class="fas fa-stop" aria-hidden="true"></i
          >{{ task.status === 'cancelling' ? t('progressCenter.cancelling') : t('common.cancel') }}
        </button>
        <button v-else type="button" class="archive-stop-button" @click="emit('remove', task.id)">
          <i class="fas fa-times" aria-hidden="true"></i>{{ t('common.remove') }}
        </button>
        <p v-if="task.error" class="m-0 text-xs text-error">{{ task.error }}</p>
        <p v-if="task.warning" class="m-0 text-xs text-warning">{{ task.warning }}</p>
      </li>
    </ul>

    <ul v-else class="progress-scrollbar m-0 min-h-0 flex-1 list-none overflow-y-auto p-3">
      <li
        v-for="task in sorted"
        :key="task.id"
        data-testid="transfer-progress-task"
        :data-task-id="task.id"
        :data-task-kind="task.kind"
        :data-task-status="task.status"
        class="mb-3 last:mb-0"
      >
        <div class="mb-1 flex min-w-0 items-center gap-2 text-xs">
          <span class="min-w-0 flex-1 truncate" :title="task.currentFile || task.label"
            >{{ t(`progressCenter.kind.${task.kind}`) }} · {{ currentFilename(task) }}</span
          >
          <span class="shrink-0 tabular-nums">{{ Math.round(task.progress * 10) / 10 }}%</span>
        </div>
        <progress
          data-testid="transfer-progress-bar"
          :value="task.progress"
          max="100"
          class="legacy-progress block h-2 w-full"
        ></progress>
        <div class="mt-1 flex items-center justify-between gap-2 text-[11px] text-text-secondary">
          <span :class="task.status === 'error' ? 'text-error' : ''">{{
            task.error || t(`progressCenter.status.${task.status}`)
          }}</span>
          <span class="shrink-0 tabular-nums">
            <template v-if="task.totalBytes > 0"
              >{{ formatBytes(task.bytesWritten) }} / {{ formatBytes(task.totalBytes) }}</template
            >
            <template v-else-if="task.totalFiles !== null">{{ task.completedFiles }} / {{ task.totalFiles }}</template>
            <template v-else>{{ formatBytes(task.bytesWritten) }}</template>
          </span>
        </div>
        <div v-if="!done(task.status)" class="mt-1 flex justify-end">
          <button
            type="button"
            data-testid="transfer-progress-cancel"
            class="text-xs text-error hover:underline"
            @click="emit('cancel', task.id)"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </li>
    </ul>

    <button
      type="button"
      data-testid="transfer-progress-resize"
      class="transfer-progress-resize"
      :title="t('progressCenter.resize')"
      :aria-label="t('progressCenter.resize')"
      @pointerdown.stop="resize.startResize"
    ></button>
  </div>
</template>

<style scoped>
  .transfer-progress-window {
    min-width: min(340px, calc(100vw - 16px));
    min-height: min(190px, calc(100vh - 16px));
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    border-radius: 10px;
  }
  .transfer-progress-window--archive {
    border-color: color-mix(in srgb, var(--border-color) 75%, var(--link-active-color, #007bff));
    border-radius: 12px;
    background: color-mix(in srgb, var(--app-bg-color) 94%, transparent);
    backdrop-filter: blur(12px);
  }
  .transfer-progress-header {
    display: flex;
    min-height: 45px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid var(--border-color);
    padding: 10px 12px;
    cursor: grab;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--link-active-color, #007bff) 12%, transparent),
      color-mix(in srgb, var(--header-bg-color) 92%, transparent)
    );
  }
  .transfer-progress-window--archive .transfer-progress-header {
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--link-active-color, #007bff) 16%, transparent),
      transparent
    );
  }
  .dragging .transfer-progress-header {
    cursor: grabbing;
  }
  .progress-icon-button {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 7px;
    color: var(--text-color-secondary);
    transition: 150ms ease;
  }
  .progress-icon-button:hover {
    border-color: var(--border-color);
    background: color-mix(in srgb, var(--border-color) 55%, transparent);
    color: var(--text-color);
  }
  .upload-task-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 7rem 3.25rem auto;
    align-items: center;
    column-gap: 0.5rem;
    row-gap: 0.25rem;
  }
  .legacy-progress {
    appearance: none;
    overflow: hidden;
    border-radius: 999px;
    background: #d1d5db;
  }
  .legacy-progress::-webkit-progress-bar {
    border-radius: 999px;
    background: #d1d5db;
  }
  .legacy-progress::-webkit-progress-value {
    border-radius: 999px;
    background: #2563eb;
  }
  .legacy-progress::-moz-progress-bar {
    border-radius: 999px;
    background: #2563eb;
  }
  .archive-icon {
    display: grid;
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 9px;
    background: color-mix(in srgb, var(--link-active-color, #007bff) 20%, transparent);
    color: var(--link-active-color, #007bff);
  }
  .archive-percent {
    border-radius: 999px;
    padding: 2px 7px;
    background: color-mix(in srgb, var(--link-active-color, #007bff) 17%, transparent);
    color: var(--link-active-color, #007bff);
    font:
      600 11px ui-monospace,
      monospace;
  }
  .archive-progress-body {
    display: grid;
    gap: 10px;
    padding: 11px 12px 12px;
  }
  .archive-progress-body + .archive-progress-body {
    border-top: 1px solid var(--border-color);
  }
  .archive-progress-track {
    height: 7px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--border-color);
  }
  .archive-progress-value {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    transform-origin: left center;
    background-image: linear-gradient(
      90deg,
      var(--link-active-color, #007bff),
      color-mix(in srgb, var(--link-active-color, #007bff) 55%, white)
    );
    transition: transform 180ms ease;
  }
  .archive-current-file {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 7px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--border-color) 40%, transparent);
    padding: 7px 9px;
    font-size: 12px;
    color: var(--text-color-secondary);
  }
  .archive-stop-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 1px solid rgba(239, 68, 68, 0.4);
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.12);
    padding: 7px 10px;
    color: rgb(248, 113, 113);
    font-size: 12px;
    font-weight: 600;
  }
  .archive-stop-button:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.2);
  }
  .archive-stop-button:disabled {
    cursor: wait;
    opacity: 0.65;
  }
  .progress-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .progress-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .progress-scrollbar::-webkit-scrollbar-thumb {
    border-radius: 10px;
    background-color: rgba(128, 128, 128, 0.3);
  }
  .progress-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(128, 128, 128, 0.3) transparent;
  }
  .transfer-progress-resize {
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 18px;
    height: 18px;
    border: 0;
    background: transparent;
    cursor: nwse-resize;
    opacity: 0.55;
  }
  .transfer-progress-resize::before,
  .transfer-progress-resize::after {
    content: '';
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 8px;
    height: 1px;
    background: var(--text-secondary-color, currentColor);
    transform: rotate(-45deg);
    transform-origin: right center;
  }
  .transfer-progress-resize::after {
    right: 6px;
    width: 5px;
  }
  @media (max-width: 520px) {
    .upload-task-row {
      grid-template-columns: minmax(0, 1fr) 5.75rem 2.75rem auto;
      column-gap: 0.35rem;
    }
  }
</style>
