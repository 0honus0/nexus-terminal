<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { UploadItem } from '../types/upload.types'; 

const POSITION_KEY = 'nexusUploadPopupPosition';

const props = defineProps<{
  uploads: Record<string, UploadItem>; // 接收上传任务字典
}>();

const emit = defineEmits<{
  (e: 'cancel-upload', uploadId: string): void;
  (e: 'cancel-all'): void;
}>();

const { t } = useI18n();

const popupRef = ref<HTMLElement | null>(null);
const position = ref({ x: 16, y: 16 });
const dragging = ref(false);
const positionReady = ref(false);
let dragOffsetX = 0;
let dragOffsetY = 0;
let positionRestored = false;

const cancellableCount = computed(() => Object.values(props.uploads).filter(
  upload => ['pending', 'uploading', 'paused', 'conflict'].includes(upload.status)
).length);
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
}));

const clampPosition = () => {
  const element = popupRef.value;
  if (!element) return;
  const maxX = Math.max(8, window.innerWidth - element.offsetWidth - 8);
  const maxY = Math.max(8, window.innerHeight - element.offsetHeight - 8);
  position.value = {
    x: Math.min(Math.max(8, position.value.x), maxX),
    y: Math.min(Math.max(8, position.value.y), maxY),
  };
};

const savePosition = () => {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position.value));
  } catch {
    // Drag position persistence is optional.
  }
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

const handlePointerMove = (event: PointerEvent) => {
  if (!dragging.value) return;
  position.value = { x: event.clientX - dragOffsetX, y: event.clientY - dragOffsetY };
  clampPosition();
};

const stopDragging = () => {
  if (!dragging.value) return;
  dragging.value = false;
  document.body.style.userSelect = '';
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', stopDragging);
  savePosition();
};

const startDragging = (event: PointerEvent) => {
  if ((event.target as HTMLElement).closest('button')) return;
  const rect = popupRef.value?.getBoundingClientRect();
  if (!rect) return;
  event.preventDefault();
  dragging.value = true;
  dragOffsetX = event.clientX - rect.left;
  dragOffsetY = event.clientY - rect.top;
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', stopDragging);
};

const handleCancel = (uploadId: string) => {
  emit('cancel-upload', uploadId);
};

const handleCancelAll = () => {
  emit('cancel-all');
};

watch(() => uploadList.value.length, async (count) => {
  if (count <= 0) {
    stopDragging();
    return;
  }

  await nextTick();
  if (dragging.value) return;

  if (!positionRestored) {
    positionRestored = true;
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
  window.addEventListener('resize', clampPosition);
  lastSpeedSampleAt = performance.now();
  speedTimer = window.setInterval(sampleTotalUploadSpeed, 500);
});
onBeforeUnmount(() => {
  stopDragging();
  if (speedTimer !== null) window.clearInterval(speedTimer);
  speedTimer = null;
  speedSnapshots.clear();
  window.removeEventListener('resize', clampPosition);
});
</script>

<template>
  <!-- 仅当有上传任务时显示 -->
  <div
    v-if="uploadList.length > 0"
    ref="popupRef"
    class="upload-popup fixed bg-background border border-border rounded-md shadow-md max-w-xs max-h-48 overflow-hidden z-[1001] text-sm"
    :class="{ dragging }"
    :style="[popupStyle, { visibility: positionReady ? 'visible' : 'hidden' }]"
  >
    <div class="upload-popup-header flex items-center justify-between gap-3 border-b border-border px-3 py-2" @pointerdown="startDragging">
      <h4 class="m-0 min-w-0 truncate text-sm font-semibold">{{ t('fileManager.uploadTasks') }}:</h4>
      <div class="ml-auto flex items-center gap-2">
        <span v-if="hasUploading" class="whitespace-nowrap text-xs tabular-nums text-text-secondary">
          {{ t('fileManager.uploadSpeed') }} {{ formatTransferRate(totalUploadSpeed) }}
        </span>
        <button
          v-if="cancellableCount > 1"
          type="button"
          class="rounded border border-red-300 bg-red-100 px-2 py-0.5 text-xs text-red-700 hover:bg-red-200"
          @click="handleCancelAll"
        >
          {{ t('fileManager.actions.cancelAll') }} ({{ cancellableCount }})
        </button>
      </div>
    </div>
    <ul class="custom-scrollbar max-h-36 list-none overflow-y-auto p-3 m-0">
      <li v-for="upload in uploadList" :key="upload.id" class="mb-1.5 text-xs flex items-center flex-wrap gap-2 last:mb-0">
        <span class="flex-grow truncate" :title="upload.filename">{{ upload.filename }} ({{ t(`fileManager.uploadStatus.${upload.status}`) }})</span>
        <progress v-if="(upload.status === 'uploading' && upload.progress < 100) || upload.status === 'pending'" :value="upload.progress" max="100" class="w-20 h-2 flex-shrink-0 [&::-webkit-progress-bar]:rounded-lg [&::-webkit-progress-value]:rounded-lg [&::-webkit-progress-bar]:bg-gray-300 [&::-webkit-progress-value]:bg-blue-600 [&::-moz-progress-bar]:bg-blue-600"></progress>
        <span v-if="upload.status === 'uploading' && upload.progress < 100" class="text-xs flex-shrink-0 tabular-nums"> {{ formatProgress(upload.progress) }}%</span>
        <span v-if="upload.status === 'error'" class="text-red-600 basis-full text-xs"> {{ t('fileManager.errors.generic') }}: {{ upload.error }}</span>
        <span v-if="upload.status === 'success' || (upload.status === 'uploading' && upload.progress === 100)" class="text-green-600"> ✅</span>
        <span v-if="upload.status === 'cancelled'" class="text-red-600"> ❌ {{ t('fileManager.uploadStatus.cancelled') }}</span>
        <!-- 只有在可取消状态时显示取消按钮 -->
        <button v-if="['pending', 'uploading', 'paused', 'conflict'].includes(upload.status)" @click="handleCancel(upload.id)" class="ml-auto px-1.5 py-0.5 text-xs bg-red-100 border border-red-300 text-red-700 cursor-pointer rounded hover:bg-red-200 flex-shrink-0">{{ t('fileManager.actions.cancel') }}</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.upload-popup {
  width: min(320px, calc(100vw - 16px));
}
.upload-popup.dragging {
  cursor: grabbing;
  transition: none;
}
.upload-popup-header {
  cursor: grab;
  background: linear-gradient(135deg, color-mix(in srgb, var(--link-active-color, #007bff) 10%, transparent), transparent);
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
