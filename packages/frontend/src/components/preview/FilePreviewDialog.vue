<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../../types/sftp.types';
import { filePreviewTabsContextKey } from '../../composables/file-preview/tabsContext';

const props = withDefaults(defineProps<{
  file: FileListItem;
  subtitle?: string;
  active?: boolean;
}>(), {
  active: true,
});

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const tabsContext = inject(filePreviewTabsContextKey, null);
const dialogRef = ref<HTMLElement | null>(null);
let standalonePreviouslyFocusedElement: HTMLElement | null = null;

const tabs = computed(() => tabsContext?.tabs.value ?? []);
const activeTabId = computed(() => tabsContext?.activeTabId.value ?? null);
const isRefreshing = computed(() => Boolean(
  tabsContext && activeTabId.value && tabsContext.refreshingTabIds.value.has(activeTabId.value)
));
const hide = () => {
  if (tabsContext) {
    tabsContext.hide();
    return;
  }
  emit('close');
};

const close = () => {
  if (tabsContext) {
    tabsContext.closeWorkspace();
    return;
  }
  emit('close');
};

const activateTab = (tabId: string) => tabsContext?.activate(tabId);
const refreshCurrentTab = () => {
  if (!tabsContext || !activeTabId.value || isRefreshing.value) return;
  void tabsContext.refresh(activeTabId.value);
};
const closeTab = (event: MouseEvent, tabId: string) => {
  event.stopPropagation();
  tabsContext?.close(tabId);
};

const handleTabKeydown = (event: KeyboardEvent, tabId: string) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  activateTab(tabId);
};

const scrollActiveTabIntoView = () => {
  const activeId = activeTabId.value;
  if (!activeId || !dialogRef.value) return;
  const activeTab = Array.from(dialogRef.value.querySelectorAll<HTMLElement>('[data-preview-tab-id]'))
    .find((element) => element.dataset.previewTabId === activeId);
  activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
};

const handleKeydown = (event: KeyboardEvent) => {
  if (!props.active || event.defaultPrevented) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    hide();
  }
};

onMounted(() => {
  if (!tabsContext) {
    standalonePreviouslyFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }
  document.addEventListener('keydown', handleKeydown);
  if (props.active) void nextTick(() => dialogRef.value?.focus());
});

watch(() => props.active, (active) => {
  if (!active) return;
  void nextTick(() => {
    dialogRef.value?.focus();
    scrollActiveTabIntoView();
  });
});

watch(activeTabId, () => {
  if (props.active) void nextTick(scrollActiveTabIntoView);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
  if (!tabsContext && props.active && standalonePreviouslyFocusedElement?.isConnected) {
    standalonePreviouslyFocusedElement.focus({ preventScroll: true });
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="dialogRef"
      data-file-preview-dialog
      class="file-preview-dialog fixed inset-0 z-[1100] flex items-center justify-center bg-black/80 outline-none"
      :style="props.active ? undefined : { display: 'none' }"
      role="dialog"
      aria-modal="true"
      :aria-label="props.file.filename"
      tabindex="-1"
      @click.self="hide"
    >
      <section class="file-preview-panel relative flex h-full w-full max-w-[1400px] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl">
        <div
          v-if="tabsContext && tabs.length"
          data-testid="file-preview-tabs"
          role="tablist"
          :aria-label="t('fileManager.preview.openFiles', 'Open previews')"
          class="file-preview-tabs flex shrink-0 overflow-x-auto border-b border-border bg-header"
        >
          <div
            v-for="tab in tabs"
            :key="tab.id"
            role="tab"
            :aria-label="tab.filename"
            :aria-selected="tab.id === activeTabId"
            :tabindex="tab.id === activeTabId ? 0 : -1"
            :title="tab.filePath"
            :data-preview-tab-id="tab.id"
            class="group flex min-h-11 min-w-0 max-w-56 shrink-0 cursor-pointer items-center gap-1 border-r border-border px-2 py-0 text-xs outline-none transition-colors focus:ring-1 focus:ring-inset focus:ring-primary sm:min-h-0 sm:gap-2 sm:px-3 sm:py-2"
            :class="tab.id === activeTabId
              ? 'bg-background text-foreground'
              : 'bg-header text-text-secondary hover:bg-border/70 hover:text-foreground'"
            @click="activateTab(tab.id)"
            @keydown="handleTabKeydown($event, tab.id)"
          >
            <span class="min-w-0 flex-1 truncate">{{ tab.filename }}</span>
            <button
              type="button"
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded text-lg leading-none opacity-70 hover:bg-border hover:opacity-100 focus:opacity-100 focus:outline-none sm:h-5 sm:w-5 sm:text-sm"
              :aria-label="t('fileManager.preview.closeFile', { file: tab.filename }, `Close tab ${tab.filename}`)"
              @click="closeTab($event, tab.id)"
            >
              ×
            </button>
          </div>
        </div>

        <header class="flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-header px-3 py-1.5 sm:min-h-12 sm:gap-3 sm:px-4 sm:py-2">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium" :title="props.file.filename">{{ props.file.filename }}</div>
            <div v-if="props.subtitle" class="hidden truncate text-xs text-text-secondary sm:block">{{ props.subtitle }}</div>
          </div>
          <slot name="toolbar" />
          <button
            v-if="tabsContext"
            type="button"
            data-testid="file-preview-refresh"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-sm text-text-secondary hover:bg-border hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-wait disabled:opacity-60 sm:h-8 sm:w-8"
            :disabled="isRefreshing"
            :aria-busy="isRefreshing"
            :aria-label="t('fileManager.preview.refresh', 'Refresh preview')"
            :title="t('fileManager.preview.refresh', 'Refresh preview')"
            @click="refreshCurrentTab"
          >
            <i class="fas fa-rotate" :class="isRefreshing ? 'fa-spin' : ''" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-2xl leading-none text-text-secondary hover:bg-border hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:h-8 sm:w-8 sm:text-xl"
            :aria-label="t('fileManager.preview.close', 'Close preview')"
            @click="close"
          >
            ×
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-auto">
          <slot />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.file-preview-dialog {
  padding-top: max(0.75rem, env(safe-area-inset-top));
  padding-right: max(0.75rem, env(safe-area-inset-right));
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
  padding-left: max(0.75rem, env(safe-area-inset-left));
}

.file-preview-panel {
  max-height: 94vh;
  max-height: 94dvh;
}

.file-preview-tabs {
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  -webkit-overflow-scrolling: touch;
}

.file-preview-tabs > [role='tab'] {
  scroll-snap-align: start;
}

@media (min-width: 768px) {
  .file-preview-dialog {
    padding-top: max(1.5rem, env(safe-area-inset-top));
    padding-right: max(1.5rem, env(safe-area-inset-right));
    padding-bottom: max(1.5rem, env(safe-area-inset-bottom));
    padding-left: max(1.5rem, env(safe-area-inset-left));
  }
}
</style>
