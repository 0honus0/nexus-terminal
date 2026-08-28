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
let previouslyFocusedElement: HTMLElement | null = null;

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

const handleKeydown = (event: KeyboardEvent) => {
  if (!props.active) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    hide();
  }
};

onMounted(() => {
  previouslyFocusedElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  document.addEventListener('keydown', handleKeydown);
  if (props.active) void nextTick(() => dialogRef.value?.focus());
});

watch(() => props.active, (active) => {
  if (active) void nextTick(() => dialogRef.value?.focus());
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
  if (!tabsContext && props.active) previouslyFocusedElement?.focus({ preventScroll: true });
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="dialogRef"
      class="fixed inset-0 z-[1100] flex items-center justify-center bg-black/80 p-3 md:p-6 outline-none"
      :style="props.active ? undefined : { display: 'none' }"
      role="dialog"
      aria-modal="true"
      :aria-label="props.file.filename"
      tabindex="-1"
      @click.self="hide"
    >
      <section class="flex h-full max-h-[94vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl">
        <div
          v-if="tabsContext && tabs.length"
          data-testid="file-preview-tabs"
          role="tablist"
          :aria-label="t('fileManager.preview.openFiles', 'Open previews')"
          class="flex shrink-0 overflow-x-auto border-b border-border bg-header"
        >
          <div
            v-for="tab in tabs"
            :key="tab.id"
            role="tab"
            :aria-label="tab.filename"
            :aria-selected="tab.id === activeTabId"
            :tabindex="tab.id === activeTabId ? 0 : -1"
            :title="tab.filePath"
            class="group flex min-w-0 max-w-56 shrink-0 cursor-pointer items-center gap-2 border-r border-border px-3 py-2 text-xs outline-none transition-colors focus:ring-1 focus:ring-inset focus:ring-primary"
            :class="tab.id === activeTabId
              ? 'bg-background text-foreground'
              : 'bg-header text-text-secondary hover:bg-border/70 hover:text-foreground'"
            @click="activateTab(tab.id)"
            @keydown="handleTabKeydown($event, tab.id)"
          >
            <span class="min-w-0 flex-1 truncate">{{ tab.filename }}</span>
            <button
              type="button"
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-sm leading-none opacity-60 hover:bg-border hover:opacity-100 focus:opacity-100 focus:outline-none"
              :aria-label="t('fileManager.preview.closeFile', { file: tab.filename }, `Close tab ${tab.filename}`)"
              @click="closeTab($event, tab.id)"
            >
              ×
            </button>
          </div>
        </div>

        <header class="flex min-h-12 shrink-0 items-center gap-3 border-b border-border bg-header px-4 py-2">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium" :title="props.file.filename">{{ props.file.filename }}</div>
            <div v-if="props.subtitle" class="truncate text-xs text-text-secondary">{{ props.subtitle }}</div>
          </div>
          <slot name="toolbar" />
          <button
            v-if="tabsContext"
            type="button"
            data-testid="file-preview-refresh"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-sm text-text-secondary hover:bg-border hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-wait disabled:opacity-60"
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
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-xl leading-none text-text-secondary hover:bg-border hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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
