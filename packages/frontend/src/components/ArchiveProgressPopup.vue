<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ArchiveProgressState } from '../types/sftp.types';

const props = defineProps<{ progress: ArchiveProgressState }>();
const { t } = useI18n();

const operationLabel = computed(() => props.progress.operation === 'compress'
  ? t('fileManager.contextMenu.compress')
  : t('fileManager.contextMenu.decompress'));

const displayFileName = computed(() => {
  const name = props.progress.currentFile;
  if (!name) return null;
  return name.length > 50 ? `${name.slice(0, 47)}...` : name;
});
</script>

<template>
  <Transition name="archive-progress">
    <div
      v-if="progress.active"
      class="fixed bottom-4 left-4 z-[1001] max-w-sm rounded border border-border bg-background p-3 text-sm text-foreground shadow-lg"
    >
      <div class="mb-1.5 flex items-center gap-2 font-semibold">
        <i class="fas fa-cog fa-spin"></i>
        <span>{{ operationLabel }} {{ progress.archiveName || '...' }}</span>
      </div>
      <div class="space-y-1.5 text-xs text-text-secondary">
        <div v-if="progress.percent !== null" class="space-y-1">
          <div class="flex items-center justify-between gap-4">
            <span>{{ t('fileManager.archiveProgress.filesProcessedTotal', { count: progress.fileCount, total: progress.totalFiles }) }}</span>
            <span class="font-mono font-semibold text-foreground">{{ progress.percent }}%</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              class="h-full rounded-full bg-primary transition-[width] duration-200"
              :style="{ width: `${progress.percent}%` }"
            ></div>
          </div>
        </div>
        <div v-else-if="progress.fileCount > 0">
          {{ t('fileManager.archiveProgress.filesProcessed', { count: progress.fileCount }) }}
        </div>
        <div v-if="displayFileName" class="truncate" :title="progress.currentFile || ''">
          {{ displayFileName }}
        </div>
        <div v-if="progress.fileCount === 0 && !displayFileName" class="italic">
          {{ t('fileManager.archiveProgress.starting') }}
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.archive-progress-enter-active,
.archive-progress-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.archive-progress-enter-from,
.archive-progress-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
