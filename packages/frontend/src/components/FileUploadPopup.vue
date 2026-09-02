<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { UploadItem } from '../types/upload.types';
import { useProgressCenterStore } from '../stores/progressCenter.store';
import { useDraggablePosition } from '@/foundation/interaction/useDraggablePosition';
import { useResizeHandle } from '@/foundation/interaction/useResizeHandle';

const POSITION_KEY = 'nexusUploadPopupPosition';
const SIZE_KEY = 'nexusUploadPopupSize';
const DEFAULT_SIZE = { width: 440, height: 300 };
const MIN_SIZE = { width: 340, height: 190 };

const props = withDefaults(defineProps<{
  uploads: Record<string, UploadItem>; // 接收上传任务字典
  sessionLabel?: string;
  progressSourceId?: string;
  visible?: boolean;
  restoreToken?: number;
}>(), {
  sessionLabel: '',
  progressSourceId: '',
  visible: true,
  restoreToken: 0,
});

const emit = defineEmits<{
  (e: 'cancel-upload', uploadId: string): void;
  (e: 'cancel-all'): void;
}>();

const { t } = useI18n();
const progressCenter = useProgressCenterStore();

const popupRef = ref<HTMLElement | null>(null);
const position = ref({ x: 16, y: 16 });
const popupSize = ref({ ...DEFAULT_SIZE });
const positionReady = ref(false);
let positionRestored = false;

const cancellableCount = computed(() => Object.values(props.uploads).filter(
  upload => ['pending', 'uploading', 'paused', 'conflict'].includes(upload.status)
).length);
const sourceHidden = computed(() => props.progressSourceId ? progressCenter.isSourceHidden(props.progressSourceId) : false);
const hasUploading = computed(() => Object.values(props.uploads).some(upload => upload.status === 'uploading'));
const totalUploadSpeed = ref(0);
const speedSnapshots = new Map<string, number>();
let speedTimer: number | null = null;
let lastSpeedSampleAt = performance.now();

const formatProgress = (progress: number) => {
  const normalized = Math.max(0, Math.min(100, progress));
  return normalized >= 100 ? '100' : normalized.toFixed(1);
};

const formatTransferRate = (bytesPerSecond: number) => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 1) return '0 B/s';
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 ** 2) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  if (bytesPerSecond < 1024 ** 3) return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024 ** 3).toFixed(1)} GB/s`;
};

const sampleTotalUploadSpeed = () => {
  const now = performance.now();
  const elapsedMs = Math.max(1, now - lastSpeedSampleAt);
  lastSpeedSampleAt = now;
  let bytesDelta = 0;
  const activeIds = new Set<string>();

  for (const upload of Object.values(props.uploads)) {
    if (upload.status !== 'uploading') continue;
    activeIds.add(upload.id);
    const previousBytes = speedSnapshots.get(upload.id);
    if (previousBytes !== undefined && upload.bytesWritten >= previousBytes) {
      bytesDelta += upload.bytesWritten - previousBytes;
    }
    speedSnapshots.set(upload.id, upload.bytesWritten);
  }

  for (const uploadId of [...speedSnapshots.keys()]) {
    if (!activeIds.has(uploadId)) speedSnapshots.delete(uploadId);
  }

  if (!activeIds.size) {
    totalUploadSpeed.value = 0;
    return;
  }

  const instantSpeed = bytesDelta * 1000 / elapsedMs;
  totalUploadSpeed.value = totalUploadSpeed.value > 0
    ? totalUploadSpeed.value * 0.55 + instantSpeed * 0.45
    : instantSpeed;
  if (totalUploadSpeed.value < 1) totalUploadSpeed.value = 0;
};

// 计算显示的上传列表（可以过滤掉已完成/取消的，或者全部显示）
// 这里选择全部显示，让用户能看到最终状态
const uploadList = computed(() => Object.values(props.uploads).filter(upload => {
  const isEffectivelySuccess = upload.status === 'success' || (upload.status === 'uploading' && upload.progress === 100);
  return !isEffectivelySuccess && upload.status !== 'cancelled';
}));

const popupStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  width: `${popupSize.value.width}px`,
  height: `${popupSize.value.height}px`,
}));

const clampSizeToViewport = () => {
  const maxWidth = Math.max(220, window.innerWidth - 16);
  const maxHeight = Math.max(150, window.innerHeight - 16);
  const minWidth = Math.min(MIN_SIZE.width, maxWidth);
  const minHeight = Math.min(MIN_SIZE.height, maxHeight);
  popupSize.value = {
    width: Math.min(Math.max(minWidth, popupSize.value.width), maxWidth),
    height: Math.min(Math.max(minHeight, popupSize.value.height), maxHeight),
  };
};

const constrainPosition = (candidate: { x: number; y: number }, element: HTMLElement) => {
  const maxX = Math.max(8, window.innerWidth - element.offsetWidth - 8);
  const maxY = Math.max(8, window.innerHeight - element.offsetHeight - 8);
  return {
    x: Math.min(Math.max(8, candidate.x), maxX),
    y: Math.min(Math.max(8, candidate.y), maxY),
  };
};

const clampPosition = () => {
  const element = popupRef.value;
  if (!element) return;
  position.value = constrainPosition(position.value, element);
};

const clampLayout = () => {
  clampSizeToViewport();
  nextTick(clampPosition);
};

const savePosition = () => {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position.value));
  } catch {
    // Drag position persistence is optional.
  }
};

const saveSize = () => {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(popupSize.value));
  } catch {
    // Size persistence is optional.
  }
};

const restoreSize = () => {
  try {
    const saved = localStorage.getItem(SIZE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { width?: number; height?: number };
      if (Number.isFinite(parsed.width) && Number.isFinite(parsed.height)) {
        popupSize.value = { width: parsed.width as number, height: parsed.height as number };
      }
    }
  } catch {
    popupSize.value = { ...DEFAULT_SIZE };
  }
  clampSizeToViewport();
};

const restorePosition = async () => {
  try {
    const saved = localStorage.getItem(POSITION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { x?: number; y?: number };
      if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        position.value = { x: parsed.x as number, y: parsed.y as number };
        await nextTick();
        clampPosition();
        return;
      }
    }
  } catch {
    // Ignore malformed storage.
  }

  await nextTick();
  const element = popupRef.value;
  if (element) {
    position.value = {
      x: Math.max(8, window.innerWidth - element.offsetWidth - 16),
      y: Math.max(8, window.innerHeight - element.offsetHeight - 16),
    };
  }
};

const { dragging, startDragging, stopDragging } = useDraggablePosition({
  position,
  getElement: () => popupRef.value,
  constrain: (candidate, element) => constrainPosition(candidate, element),
  canStart: (event) => !(event.target as HTMLElement).closest('button'),
  onEnd: savePosition,
});

const popupWidth = computed({
  get: () => popupSize.value.width,
  set: (width: number) => { popupSize.value = { ...popupSize.value, width }; },
});
const popupHeight = computed({
  get: () => popupSize.value.height,
  set: (height: number) => { popupSize.value = { ...popupSize.value, height }; },
});
const { isResizing: resizing, startResize: startResizing } = useResizeHandle({
  width: popupWidth,
  height: popupHeight,
  minWidth: MIN_SIZE.width,
  minHeight: MIN_SIZE.height,
  maxWidth: () => Math.max(220, window.innerWidth - 16),
  maxHeight: () => Math.max(150, window.innerHeight - 16),
  onMove: ({ width, height }) => {
    position.value = {
      x: Math.max(8, Math.min(position.value.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(position.value.y, window.innerHeight - height - 8)),
    };
  },
  onEnd: () => {
    saveSize();
    savePosition();
  },
});

const handleCancel = (uploadId: string) => {
  emit('cancel-upload', uploadId);
};

const handleCancelAll = () => {
  emit('cancel-all');
};

const hidePopup = () => {
  if (!props.progressSourceId) return;
  progressCenter.hideSource(props.progressSourceId);
};


watch(() => props.restoreToken, async () => {
  restoreSize();
  await restorePosition();
  positionReady.value = true;
  await nextTick();
  clampPosition();
});

watch(() => uploadList.value.length, async (count) => {
  if (count <= 0) {
    stopDragging();
    return;
  }
  await nextTick();
  if (dragging.value) return;

  if (!positionRestored) {
    positionRestored = true;
    restoreSize();
    await restorePosition();
    positionReady.value = true;
    return;
  }

  // Upload items frequently enter and leave the list. Only keep the popup inside
  // the viewport; never restore the saved coordinates again during the same mount.
  clampPosition();
  positionReady.value = true;
}, { immediate: true });

onMounted(() => {
  window.addEventListener('resize', clampLayout);
  lastSpeedSampleAt = performance.now();
  speedTimer = window.setInterval(sampleTotalUploadSpeed, 500);
});
onBeforeUnmount(() => {
  if (speedTimer !== null) window.clearInterval(speedTimer);
  speedTimer = null;
  speedSnapshots.clear();
  window.removeEventListener('resize', clampLayout);
});
</script>

<template>
  <!-- 仅当有上传任务时显示 -->
  <div
    v-if="props.visible && !sourceHidden && uploadList.length > 0"
    ref="popupRef"
    data-testid="file-upload-progress-popup"
    class="upload-popup fixed z-40 flex flex-col overflow-hidden border border-border bg-background text-sm shadow-xl"
    :class="{ dragging, resizing }"
    :style="[popupStyle, { visibility: positionReady ? 'visible' : 'hidden' }]"
  >
    <div class="upload-popup-header border-b border-border px-3 py-2.5" @pointerdown="startDragging">
      <div data-testid="file-upload-header-meta" class="flex min-w-0 items-center gap-2">
        <h4 class="m-0 min-w-0 flex-1 truncate text-sm font-semibold" :title="props.sessionLabel || undefined">
          <span v-if="props.sessionLabel">{{ props.sessionLabel }} · </span>{{ t('fileManager.uploadTasks') }}
        </h4>
        <span
          v-if="hasUploading"
          data-testid="file-upload-speed"
          class="shrink-0 whitespace-nowrap rounded-md bg-black/5 px-2 py-1 text-xs tabular-nums text-text-secondary dark:bg-white/5"
        >
          {{ t('fileManager.uploadSpeed') }} {{ formatTransferRate(totalUploadSpeed) }}
        </span>
        <button
          v-if="props.progressSourceId"
          type="button"
          data-testid="file-upload-progress-hide"
          class="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-transparent text-text-secondary transition-colors hover:border-border hover:bg-border/50 hover:text-foreground"
          @click="hidePopup"
          :title="t('progressCenter.hide', '隐藏进度')"
          :aria-label="t('progressCenter.hide', '隐藏进度')"
        >
          <i class="fas fa-minus"></i>
        </button>
        <button
          v-if="cancellableCount > 1"
          type="button"
          data-testid="file-upload-cancel-all"
          class="shrink-0 rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:bg-red-950/30 dark:text-red-300"
          @click="handleCancelAll"
        >
          {{ t('fileManager.actions.cancelAll') }} ({{ cancellableCount }})
        </button>
      </div>
    </div>
    <ul data-testid="file-upload-list" class="custom-scrollbar m-0 min-h-0 flex-1 list-none overflow-y-auto p-3">
      <li v-for="upload in uploadList" :key="upload.id" class="upload-task-row mb-1.5 text-xs last:mb-0">
        <span class="min-w-0 truncate" :title="upload.filename">{{ upload.filename }} ({{ t(`fileManager.uploadStatus.${upload.status}`) }})</span>
        <div class="min-w-0">
          <progress v-if="(upload.status === 'uploading' && upload.progress < 100) || upload.status === 'pending'" data-testid="file-upload-progress-bar" :value="upload.progress" max="100" class="h-2 w-full [&::-webkit-progress-bar]:rounded-lg [&::-webkit-progress-value]:rounded-lg [&::-webkit-progress-bar]:bg-gray-300 [&::-webkit-progress-value]:bg-blue-600 [&::-moz-progress-bar]:bg-blue-600"></progress>
        </div>
        <span data-testid="file-upload-progress-value" class="text-right text-xs tabular-nums text-text-secondary">
          {{ ['pending', 'uploading'].includes(upload.status) ? `${formatProgress(upload.progress)}%` : '—' }}
        </span>
        <!-- 只有在可取消状态时显示取消按钮 -->
        <button v-if="['pending', 'uploading', 'paused', 'conflict'].includes(upload.status)" data-testid="file-upload-cancel" @click="handleCancel(upload.id)" class="justify-self-end px-1.5 py-0.5 text-xs bg-red-100 border border-red-300 text-red-700 cursor-pointer rounded hover:bg-red-200">{{ t('fileManager.actions.cancel') }}</button>
        <span v-else></span>
        <span v-if="upload.status === 'error'" class="col-span-4 text-red-600 text-xs"> {{ t('fileManager.errors.generic') }}: {{ upload.error }}</span>
      </li>
    </ul>
    <button
      type="button"
      data-testid="file-upload-resize-handle"
      class="upload-popup-resize-handle"
      :title="t('common.resize', '调整大小')"
      :aria-label="t('common.resize', '调整大小')"
      @pointerdown.stop="startResizing"
    ></button>
  </div>
</template>

<style scoped>
.upload-popup {
  min-width: min(340px, calc(100vw - 16px));
  min-height: min(190px, calc(100vh - 16px));
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  border-radius: 10px;
}
.upload-popup.dragging {
  cursor: grabbing;
  transition: none;
}
.upload-popup.resizing {
  transition: none;
}
.upload-popup-header {
  flex-shrink: 0;
  cursor: grab;
  background: linear-gradient(135deg, color-mix(in srgb, var(--link-active-color, #007bff) 12%, transparent), color-mix(in srgb, var(--header-bg-color) 92%, transparent));
}
.upload-popup-resize-handle {
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
.upload-popup-resize-handle::before,
.upload-popup-resize-handle::after {
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
.upload-popup-resize-handle::after {
  right: 6px;
  bottom: 3px;
  width: 5px;
}
.upload-task-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 7rem 3.25rem auto;
  align-items: center;
  column-gap: 0.5rem;
  row-gap: 0.25rem;
}
.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(128, 128, 128, 0.3);
  border-radius: 10px;
}
.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.3) transparent;
}
</style>
