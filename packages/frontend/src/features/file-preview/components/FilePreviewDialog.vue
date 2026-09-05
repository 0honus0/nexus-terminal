<script setup lang="ts">
  import { computed, nextTick, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useFeedback } from '@/shared/feedback/public';
  import type { FilePreviewSessionController } from '../composables/useFilePreviewTabs';

  const props = withDefaults(
    defineProps<{
      file: { name: string; path: string };
      session: FilePreviewSessionController;
      subtitle?: string;
      active?: boolean;
    }>(),
    { active: true, subtitle: undefined },
  );
  const emit = defineEmits<{ close: [] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const root = ref<HTMLElement | null>(null);

  const activeTab = computed(
    () => props.session.tabs.value.find((tab) => tab.id === props.session.activeId.value) ?? null,
  );
  const isRefreshing = computed(() => Boolean(activeTab.value?.refreshing));

  const activateTab = (tabId: string): void => {
    props.session.activeId.value = tabId;
  };
  const closeTab = (event: MouseEvent, tabId: string): void => {
    event.stopPropagation();
    props.session.close(tabId);
  };
  const handleTabKeydown = (event: KeyboardEvent, tabId: string): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activateTab(tabId);
  };
  const refreshCurrentTab = async (): Promise<void> => {
    if (!activeTab.value || isRefreshing.value) return;
    try {
      await props.session.refresh(activeTab.value);
    } catch {
      feedback.notifyError(t('fileManager.preview.refreshFailed'));
    }
  };
  const scrollActiveTabIntoView = (): void => {
    const activeId = props.session.activeId.value;
    if (!activeId || !root.value) return;
    const active = Array.from(root.value.querySelectorAll<HTMLElement>('[data-preview-tab-id]')).find(
      (element) => element.dataset.previewTabId === activeId,
    );
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };

  watch(
    () => [props.active, props.session.activeId.value] as const,
    ([active]) => {
      if (active) void nextTick(scrollActiveTabIntoView);
    },
  );
</script>

<template>
  <section
    ref="root"
    data-file-preview-dialog
    class="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground"
  >
    <div
      v-if="active && session.tabs.value.length"
      data-testid="file-preview-tabs"
      role="tablist"
      :aria-label="t('fileManager.preview.openFiles')"
      class="file-preview-tabs flex shrink-0 overflow-x-auto border-b border-border bg-header"
    >
      <div
        v-for="tab in session.tabs.value"
        :key="tab.id"
        role="tab"
        :aria-label="tab.name"
        :aria-selected="tab.id === session.activeId.value"
        :tabindex="tab.id === session.activeId.value ? 0 : -1"
        :title="tab.path"
        :data-preview-tab-id="tab.id"
        class="group flex min-h-11 min-w-0 max-w-56 shrink-0 cursor-pointer items-center gap-1 border-r border-border px-2 py-0 text-xs outline-none transition-colors focus:ring-1 focus:ring-inset focus:ring-primary sm:min-h-0 sm:gap-2 sm:px-3 sm:py-2"
        :class="
          tab.id === session.activeId.value
            ? 'bg-background text-foreground'
            : 'bg-header text-text-secondary hover:bg-border/70 hover:text-foreground'
        "
        @click="activateTab(tab.id)"
        @keydown="handleTabKeydown($event, tab.id)"
      >
        <span class="min-w-0 flex-1 truncate">{{ tab.name }}</span>
        <button
          type="button"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded text-lg leading-none opacity-70 hover:bg-border hover:opacity-100 focus:opacity-100 focus:outline-none sm:h-5 sm:w-5 sm:text-sm"
          :aria-label="t('fileManager.preview.closeFile', { file: tab.name })"
          @click="closeTab($event, tab.id)"
        >
          ×
        </button>
      </div>
    </div>

    <header
      v-if="active"
      class="flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-header px-3 py-1.5 sm:min-h-12 sm:gap-3 sm:px-4 sm:py-2"
    >
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium" :title="file.name">{{ file.name }}</div>
        <div v-if="subtitle" class="hidden truncate text-xs text-text-secondary sm:block">{{ subtitle }}</div>
      </div>
      <slot name="toolbar" />
      <button
        type="button"
        data-testid="file-preview-refresh"
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-sm text-text-secondary hover:bg-border hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-wait disabled:opacity-60 sm:h-8 sm:w-8"
        :disabled="isRefreshing"
        :aria-busy="isRefreshing"
        :aria-label="t('fileManager.preview.refresh')"
        :title="t('fileManager.preview.refresh')"
        @click="refreshCurrentTab"
      >
        <i class="fas fa-rotate" :class="isRefreshing ? 'fa-spin' : ''" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-2xl leading-none text-text-secondary hover:bg-border hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:h-8 sm:w-8 sm:text-xl"
        :aria-label="t('fileManager.preview.close')"
        :title="t('fileManager.preview.close')"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-auto">
      <slot />
    </div>
  </section>
</template>

<style scoped>
  .file-preview-tabs {
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    -webkit-overflow-scrolling: touch;
  }

  .file-preview-tabs > [role='tab'] {
    scroll-snap-align: start;
  }
</style>
