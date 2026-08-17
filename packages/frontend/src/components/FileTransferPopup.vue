<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileTransferItem } from '../types/fileTransfer.types';

const props = withDefaults(defineProps<{
  transfers: Readonly<Record<string, FileTransferItem>>;
  sessionLabel?: string;
  visible?: boolean;
  restoreToken?: number;
}>(), {
  sessionLabel: '',
  visible: true,
  restoreToken: 0,
});

const { t } = useI18n();
const transferList = computed(() => Object.values(props.transfers));
const speedSnapshots = new Map<string, number>();
const totalSpeed = ref(0);
const minimized = ref(false);
let speedTimer: number | null = null;
let lastSampleAt = performance.now();

const formatTransferRate = (bytesPerSecond: number) => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 1) return '0 B/s';
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 ** 2) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  if (bytesPerSecond < 1024 ** 3) return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024 ** 3).toFixed(1)} GB/s`;
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

const currentFilename = (transfer: FileTransferItem) => {
  if (!transfer.currentFile) return transfer.label;
  return transfer.currentFile.split('/').filter(Boolean).pop() || transfer.currentFile;
};

const toggleMinimized = () => {
  minimized.value = !minimized.value;
};

watch(() => props.restoreToken, () => {
  minimized.value = false;
});

watch(() => transferList.value.length, (count, previousCount) => {
  if (count > 0 && !previousCount) minimized.value = false;
});

const sampleSpeed = () => {
  const now = performance.now();
  const elapsedMs = Math.max(1, now - lastSampleAt);
  lastSampleAt = now;
  let delta = 0;
  let active = 0;

  for (const transfer of transferList.value) {
    if (transfer.status !== 'running') continue;
    active += 1;
    const previous = speedSnapshots.get(transfer.id);
    if (previous !== undefined && transfer.bytesWritten >= previous) {
      delta += transfer.bytesWritten - previous;
    }
    speedSnapshots.set(transfer.id, transfer.bytesWritten);
  }

  for (const id of [...speedSnapshots.keys()]) {
    if (!props.transfers[id] || props.transfers[id].status !== 'running') speedSnapshots.delete(id);
  }

  if (!active) {
    totalSpeed.value = 0;
    return;
  }
  const instant = delta * 1000 / elapsedMs;
  totalSpeed.value = totalSpeed.value > 0 ? totalSpeed.value * 0.55 + instant * 0.45 : instant;
};

onMounted(() => {
  lastSampleAt = performance.now();
  speedTimer = window.setInterval(sampleSpeed, 500);
});

onBeforeUnmount(() => {
  if (speedTimer !== null) window.clearInterval(speedTimer);
  speedSnapshots.clear();
});
</script>

<template>
  <div
    v-if="props.visible && transferList.length"
    data-testid="file-transfer-progress-popup"
    class="fixed bottom-4 right-4 z-[1002] w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-md border border-border bg-background text-sm shadow-lg"
  >
    <div class="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
      <h4 class="m-0 truncate text-sm font-semibold" :title="props.sessionLabel || undefined">
        <span v-if="props.sessionLabel">{{ props.sessionLabel }} · </span>{{ t('fileManager.transferTasks') }}
      </h4>
      <div class="flex items-center gap-2">
        <span v-if="transferList.some(item => item.status === 'running')" class="whitespace-nowrap text-xs tabular-nums text-text-secondary">
          {{ t('fileManager.transferSpeed') }} {{ formatTransferRate(totalSpeed) }}
        </span>
        <button
          type="button"
          data-testid="file-transfer-progress-minimize"
          class="grid h-6 w-6 place-items-center rounded text-text-secondary hover:bg-border/60 hover:text-foreground"
          @click="toggleMinimized"
          :title="minimized ? t('common.expand') : t('common.minimize')"
        >
          <i :class="minimized ? 'fas fa-chevron-up' : 'fas fa-minus'"></i>
        </button>
      </div>
    </div>

    <ul v-if="!minimized" class="custom-scrollbar m-0 max-h-52 list-none overflow-y-auto p-3">
      <li v-for="transfer in transferList" :key="transfer.id" class="mb-3 last:mb-0">
        <div class="mb-1 flex min-w-0 items-center gap-2 text-xs">
          <span class="min-w-0 flex-1 truncate" :title="transfer.currentFile || transfer.label">
            {{ transfer.operation === 'move' ? t('fileManager.transferOperation.move') : t('fileManager.transferOperation.copy') }} · {{ currentFilename(transfer) }}
          </span>
          <span v-if="transfer.totalKnown" class="shrink-0 tabular-nums">{{ transfer.progress.toFixed(1) }}%</span>
          <span v-else class="shrink-0 text-text-secondary">…</span>
        </div>

        <progress
          v-if="transfer.totalKnown"
          :value="transfer.progress"
          max="100"
          class="block h-2 w-full [&::-webkit-progress-bar]:rounded-lg [&::-webkit-progress-bar]:bg-gray-300 [&::-webkit-progress-value]:rounded-lg [&::-webkit-progress-value]:bg-blue-600 [&::-moz-progress-bar]:bg-blue-600"
        />
        <progress
          v-else
          class="block h-2 w-full [&::-webkit-progress-bar]:rounded-lg [&::-webkit-progress-bar]:bg-gray-300 [&::-webkit-progress-value]:rounded-lg [&::-webkit-progress-value]:bg-blue-600 [&::-moz-progress-bar]:bg-blue-600"
        />

        <div class="mt-1 flex items-center justify-between gap-2 text-[11px] text-text-secondary">
          <span v-if="transfer.status === 'deleting'">{{ t('fileManager.transferStatus.deleting') }}</span>
          <span v-else-if="transfer.status === 'error'" class="text-red-600">{{ transfer.error || t('fileManager.errors.generic') }}</span>
          <span v-else-if="transfer.status === 'preparing'">{{ t('fileManager.transferStatus.preparing') }}</span>
          <span v-else>{{ t('fileManager.transferStatus.running') }}</span>
          <span class="shrink-0 tabular-nums">
            <template v-if="transfer.totalKnown && transfer.totalBytes > 0">{{ formatBytes(transfer.bytesWritten) }} / {{ formatBytes(transfer.totalBytes) }}</template>
            <template v-else-if="transfer.totalKnown">{{ transfer.completedFiles }} / {{ transfer.totalFiles }}</template>
            <template v-else>{{ formatBytes(transfer.bytesWritten) }}</template>
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(128, 128, 128, 0.3);
  border-radius: 10px;
}
.custom-scrollbar { scrollbar-width: thin; }
</style>
