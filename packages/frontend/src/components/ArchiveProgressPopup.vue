<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ArchiveProgressState } from '../types/sftp.types';
import { useProgressCenterStore } from '../stores/progressCenter.store';

const POSITION_KEY = 'nexusArchiveProgressPosition';
const props = withDefaults(defineProps<{
  progress: ArchiveProgressState;
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
const emit = defineEmits<{ (event: 'cancel'): void }>();
const { t } = useI18n();
const progressCenter = useProgressCenterStore();

const popupRef = ref<HTMLElement | { $el?: unknown } | null>(null);
const getPopupElement = (): HTMLElement | null => {
  const candidate = popupRef.value;
  if (candidate instanceof HTMLElement) return candidate;
  const componentElement = candidate && typeof candidate === 'object' ? candidate.$el : null;
  return componentElement instanceof HTMLElement ? componentElement : null;
};
const sourceHidden = computed(() => props.progressSourceId ? progressCenter.isSourceHidden(props.progressSourceId) : false);
const position = ref({ x: 16, y: 16 });
const dragging = ref(false);
let dragOffsetX = 0;
let dragOffsetY = 0;

const operationLabel = computed(() => props.progress.operation === 'compress'
  ? t('fileManager.contextMenu.compress')
  : t('fileManager.contextMenu.decompress'));

const normalizedPercent = computed(() => {
  const percent = props.progress.percent ?? 0;
  return Math.min(100, Math.max(0, percent));
});

const displayFileName = computed(() => {
  const name = props.progress.currentFile;
  if (!name) return null;
  return name.length > 64 ? `${name.slice(0, 61)}...` : name;
});

const popupStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
}));

const clampPosition = () => {
  const element = getPopupElement();
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
    // Position persistence is optional.
  }
};

const restorePosition = () => {
  try {
    const saved = localStorage.getItem(POSITION_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { x?: number; y?: number };
      if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        position.value = { x: parsed.x as number, y: parsed.y as number };
        return;
      }
    }
  } catch {
    // Ignore malformed storage.
  }
  nextTick(() => {
    const element = getPopupElement();
    if (element) {
      position.value = { x: 16, y: Math.max(16, window.innerHeight - element.offsetHeight - 16) };
    }
  });
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
  const rect = getPopupElement()?.getBoundingClientRect();
  if (!rect) return;
  dragging.value = true;
  dragOffsetX = event.clientX - rect.left;
  dragOffsetY = event.clientY - rect.top;
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', stopDragging);
};

const hidePopup = () => {
  if (!props.progressSourceId) return;
  progressCenter.hideSource(props.progressSourceId);
};


watch(() => props.restoreToken, async () => {
  await nextTick();
  restorePosition();
  await nextTick();
  clampPosition();
});

watch(() => props.progress.active, async (active) => {
  if (!active) return;
  await nextTick();
  restorePosition();
  await nextTick();
  clampPosition();
}, { immediate: true });

onMounted(() => window.addEventListener('resize', clampPosition));
onBeforeUnmount(() => {
  stopDragging();
  window.removeEventListener('resize', clampPosition);
});
</script>

<template>
  <Transition name="archive-progress">
    <div
      v-if="props.visible && !sourceHidden && progress.active"
      ref="popupRef"
      data-testid="archive-progress-popup"
      class="archive-progress-card"
      :class="{ dragging }"
      :style="popupStyle"
    >
      <div class="archive-progress-header" @pointerdown="startDragging">
        <div class="archive-title">
          <span class="archive-icon"><i class="fas fa-box-archive"></i></span>
          <div class="min-w-0">
            <div class="truncate font-semibold" :title="props.sessionLabel || undefined">
              <span v-if="props.sessionLabel">{{ props.sessionLabel }} · </span>{{ operationLabel }} {{ progress.archiveName || '...' }}
            </div>
            <div class="text-[11px] text-text-muted">
              {{ progress.cancelling
                ? t('fileManager.archiveProgress.stopping', '正在停止并清理临时文件...')
                : t('fileManager.archiveProgress.dragHint', '拖动标题可移动') }}
            </div>
          </div>
        </div>
        <div class="archive-actions">
          <span v-if="progress.percent !== null" class="percent-badge">{{ progress.percent }}%</span>
          <button v-if="props.progressSourceId" type="button" data-testid="archive-progress-hide" class="icon-button" @click="hidePopup" :title="t('progressCenter.hide', '隐藏进度')">
            <i class="fas fa-minus"></i>
          </button>
        </div>
      </div>

      <div class="archive-progress-body">
        <div v-if="progress.percent !== null" class="space-y-1.5">
          <div class="flex items-center justify-between gap-4 text-xs">
            <span>{{ t('fileManager.archiveProgress.filesProcessedTotal', { count: progress.fileCount, total: progress.totalFiles }) }}</span>
            <span class="font-mono text-text-muted">{{ progress.fileCount }}/{{ progress.totalFiles }}</span>
          </div>
          <div
            class="progress-track"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="normalizedPercent"
          >
            <div
              class="progress-value"
              :style="{ transform: `scaleX(${normalizedPercent / 100})` }"
            ></div>
          </div>
        </div>
        <div v-else-if="progress.fileCount > 0" class="text-xs">
          {{ t('fileManager.archiveProgress.filesProcessed', { count: progress.fileCount }) }}
        </div>
        <div v-if="displayFileName" class="current-file" :title="progress.currentFile || ''">
          <i class="far fa-file-lines"></i>
          <span class="truncate">{{ displayFileName }}</span>
        </div>
        <div v-if="progress.fileCount === 0 && !displayFileName" class="text-xs italic text-text-muted">
          {{ t('fileManager.archiveProgress.starting') }}
        </div>
        <button
          type="button"
          class="stop-button"
          :disabled="progress.cancelling"
          @click="emit('cancel')"
        >
          <i class="fas fa-stop"></i>
          {{ progress.cancelling
            ? t('fileManager.archiveProgress.stoppingShort', '正在停止')
            : (progress.operation === 'compress'
              ? t('fileManager.archiveProgress.stop', '停止压缩')
              : t('fileManager.archiveProgress.stopDecompress', '停止解压')) }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.archive-progress-card {
  position: fixed;
  z-index: 40;
  width: min(390px, calc(100vw - 16px));
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, var(--link-active-color, #007bff));
  border-radius: 12px;
  background: color-mix(in srgb, var(--app-bg-color) 94%, transparent);
  color: var(--text-color);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(12px);
}
.archive-progress-card.dragging { cursor: grabbing; transition: none; }
.archive-progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  cursor: grab;
  background: linear-gradient(135deg, color-mix(in srgb, var(--link-active-color, #007bff) 16%, transparent), transparent);
}
.archive-title, .archive-actions { display: flex; align-items: center; gap: 9px; min-width: 0; }
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
.percent-badge {
  border-radius: 999px;
  padding: 2px 7px;
  background: color-mix(in srgb, var(--link-active-color, #007bff) 17%, transparent);
  color: var(--link-active-color, #007bff);
  font: 600 11px ui-monospace, monospace;
}
.icon-button {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 7px;
  color: var(--text-color-secondary);
}
.icon-button:hover { background: color-mix(in srgb, var(--border-color) 65%, transparent); color: var(--text-color); }
.archive-progress-body { display: grid; gap: 10px; border-top: 1px solid var(--border-color); padding: 11px 12px 12px; }
.progress-track { height: 7px; overflow: hidden; border-radius: 999px; background: var(--border-color); }
.progress-value {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  transform: scaleX(0);
  transform-origin: left center;
  background-color: var(--link-active-color, #007bff);
  background-image: linear-gradient(90deg, var(--link-active-color, #007bff), color-mix(in srgb, var(--link-active-color, #007bff) 55%, white));
  transition: transform 180ms ease;
  will-change: transform;
}
.current-file { display: flex; align-items: center; gap: 7px; min-width: 0; border-radius: 7px; background: color-mix(in srgb, var(--border-color) 40%, transparent); padding: 7px 9px; font-size: 12px; color: var(--text-color-secondary); }
.stop-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.12); padding: 7px 10px; color: rgb(248, 113, 113); font-size: 12px; font-weight: 600; }
.stop-button:hover:not(:disabled) { background: rgba(239, 68, 68, 0.2); }
.stop-button:disabled { cursor: wait; opacity: 0.65; }
.archive-progress-enter-active, .archive-progress-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.archive-progress-enter-from, .archive-progress-leave-to { opacity: 0; transform: translateY(8px) scale(0.98); }
</style>
