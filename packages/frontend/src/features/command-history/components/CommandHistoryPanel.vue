<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { BaseContextMenu } from '@/foundation/ui';
  import {
    booleanStorageCodec,
    numberStorageCodec,
    readStoredValue,
    writeClipboardText,
    writeStoredValue,
  } from '@/foundation/browser';
  import { useFeedback } from '@/shared/feedback/public';
  import { focusRegistry } from '@/shared/focus/public';
  import { createWheelScaleResolver } from '@/foundation/interaction';
  import { useCommandHistoryStore } from '../store/commandHistory.store';
  import type { CommandHistoryEntryDto, ExecuteHistoryIntent } from '../model/commandHistory';

  const compactStorage = {
    namespace: 'command-history.compact',
    version: 1,
    codec: booleanStorageCodec,
    legacyKeys: ['commandHistoryCompactMode'],
  } as const;
  const rowScaleStorage = {
    namespace: 'command-history.row-scale',
    version: 1,
    codec: numberStorageCodec((value) => value >= 0.5 && value <= 2.5),
    legacyKeys: ['commandHistoryRowScale'],
  } as const;

  const props = withDefaults(
    defineProps<{
      collapsibleSearch?: boolean;
      compact?: boolean;
      rowScale?: number;
    }>(),
    { collapsibleSearch: false, compact: false, rowScale: 1 },
  );

  const emit = defineEmits<{
    execute: [intent: ExecuteHistoryIntent];
    rowScale: [scale: number];
    compactMode: [compact: boolean];
  }>();

  const { t } = useI18n();
  const feedback = useFeedback();
  const store = useCommandHistoryStore();
  const { search, loading, error, filtered, selectedIndex } = storeToRefs(store);

  const searchInput = ref<HTMLInputElement | null>(null);
  const root = ref<HTMLElement | null>(null);
  const list = ref<HTMLElement | null>(null);
  const context = ref<{ entry: CommandHistoryEntryDto; x: number; y: number } | null>(null);
  const searchExpanded = ref(!props.collapsibleSearch || Boolean(search.value));
  let unregisterFocus: (() => void) | undefined;

  const readCompactMode = (): boolean => (props.compact ? true : (readStoredValue(compactStorage) ?? false));
  const isCompact = ref(readCompactMode());
  watch(
    () => props.compact,
    (val) => {
      if (typeof val === 'boolean') isCompact.value = val;
    },
  );
  const toggleCompact = () => {
    isCompact.value = !isCompact.value;
    writeStoredValue(compactStorage, isCompact.value);
    emit('compactMode', isCompact.value);
  };

  const readRowScale = (): number => {
    if (Number.isFinite(props.rowScale) && props.rowScale !== 1) return props.rowScale!;
    return readStoredValue(rowScaleStorage) ?? 1;
  };
  const localScale = ref(readRowScale());
  const resolveScale = createWheelScaleResolver({
    min: 0.5,
    max: 2.5,
    step: 0.12,
    precision: 2,
    thresholdPx: 64,
    maxStepsPerEvent: 3,
    stopImmediatePropagation: true,
  });
  const rowStyle = computed(() => ({ '--history-row-scale': localScale.value }));
  watch(
    () => props.rowScale,
    (value) => {
      if (Number.isFinite(value)) localScale.value = value;
    },
  );
  const scaleRows = (event: WheelEvent) => {
    const change = resolveScale(event, localScale.value);
    if (!change) return;
    localScale.value = change.next;
    writeStoredValue(rowScaleStorage, change.next);
    emit('rowScale', change.next);
  };

  watch(
    () => props.collapsibleSearch,
    (enabled) => {
      searchExpanded.value = !enabled || Boolean(search.value);
    },
  );

  const openSearch = async (): Promise<boolean> => {
    searchExpanded.value = true;
    await nextTick();
    searchInput.value?.focus?.();
    return true;
  };

  onMounted(() => {
    void store.load().catch(() => undefined);
    unregisterFocus = focusRegistry.register('commandHistorySearch', openSearch, () =>
      Boolean(root.value?.getClientRects().length),
    );
  });
  onBeforeUnmount(() => unregisterFocus?.());

  const clear = async () => {
    if (!(await feedback.confirm({ message: t('commandHistory.confirmClear'), destructive: true }))) return;
    try {
      await store.clear();
    } catch (cause) {
      feedback.notifyError(
        t('commandHistory.clearFailed', { error: cause instanceof Error ? cause.message : String(cause) }),
      );
    }
  };
  const remove = async (id: number) => {
    context.value = null;
    try {
      await store.remove(id);
    } catch (cause) {
      feedback.notifyError(
        t('commandHistory.deleteFailed', { error: cause instanceof Error ? cause.message : String(cause) }),
      );
    }
  };
  const copy = async (command: string) => {
    context.value = null;
    try {
      await writeClipboardText(command);
      feedback.notifySuccess(t('commandHistory.copied'));
    } catch {
      feedback.notifyError(t('commandHistory.copyFailed'));
    }
  };
  const execute = (entry: CommandHistoryEntryDto, allSessions = false) => {
    context.value = null;
    emit('execute', { command: entry.command, allSessions: allSessions || undefined });
  };
  const openContext = (event: MouseEvent, entry: CommandHistoryEntryDto) => {
    const idx = filtered.value.findIndex((e) => e.id === entry.id);
    if (idx !== -1) {
      selectedIndex.value = idx;
    }
    context.value = { entry, x: event.clientX, y: event.clientY };
  };
  const refresh = async () => {
    try {
      await store.load();
    } catch {
      // Store error is rendered in the UI
    }
  };

  const revealSelected = () => {
    const entry = filtered.value[selectedIndex.value];
    if (!entry) return;
    root.value?.querySelector<HTMLElement>(`[data-history-id="${entry.id}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const handleSearchKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (search.value) {
        event.preventDefault();
        search.value = '';
        store.resetSelection();
        return;
      }
      if (props.collapsibleSearch) {
        event.preventDefault();
        searchExpanded.value = false;
        store.resetSelection();
        return;
      }
    }
    if (!filtered.value.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      store.selectNext();
      revealSelected();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      store.selectPrevious();
      revealSelected();
      return;
    }
    if (event.key === 'Enter') {
      const entry = filtered.value[selectedIndex.value] ?? filtered.value[0];
      if (!entry) return;
      event.preventDefault();
      execute(entry);
    }
  };
  const handleSearchBlur = () => {
    window.setTimeout(() => {
      if (document.activeElement !== searchInput.value && !list.value?.contains(document.activeElement)) {
        store.resetSelection();
        if (props.collapsibleSearch && !search.value) searchExpanded.value = false;
      }
    }, 0);
  };

  const formatTime = (ts: number): string => {
    if (!ts) return '';
    const date = new Date(ts > 1e11 ? ts : ts * 1000);
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return `${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  };

  const formatFullDate = (ts: number): string => {
    if (!ts) return '';
    const date = new Date(ts > 1e11 ? ts : ts * 1000);
    return date.toLocaleString();
  };
</script>

<template>
  <section
    ref="root"
    data-testid="command-history-view"
    class="command-history-root flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
  >
    <div
      class="command-history-controls flex shrink-0 items-center gap-2 border-b border-border/40 bg-background/80 px-2 py-1.5"
    >
      <button
        v-if="collapsibleSearch && !searchExpanded"
        data-testid="command-history-search-toggle"
        type="button"
        class="history-control"
        :title="t('commandHistory.expandSearch')"
        :aria-label="t('commandHistory.expandSearch')"
        @click="openSearch"
      >
        <i class="fas fa-search" aria-hidden="true"></i>
      </button>
      <input
        v-if="searchExpanded"
        ref="searchInput"
        v-model="search"
        data-testid="command-history-search"
        data-focus-id="commandHistorySearch"
        type="text"
        :placeholder="t('commandHistory.searchPlaceholder')"
        class="command-history-search min-w-0 flex-1 rounded-lg border border-border/50 bg-input px-4 py-1.5 text-sm text-foreground shadow-sm transition duration-150 ease-in-out focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
        @keydown="handleSearchKeydown"
        @blur="handleSearchBlur"
      />
      <button
        type="button"
        class="history-control"
        :class="{ 'bg-primary/20 text-primary': isCompact }"
        :title="t('commandHistory.compactMode')"
        :aria-label="t('commandHistory.compactMode')"
        @click="toggleCompact"
      >
        <i :class="['fas', isCompact ? 'fa-compress-alt' : 'fa-expand-alt']" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="history-control"
        :title="t('commandHistory.refresh')"
        :aria-label="t('commandHistory.refresh')"
        @click="refresh"
      >
        <i class="fas fa-sync-alt" :class="{ 'fa-spin': loading }" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="history-control history-control--danger"
        :title="t('commandHistory.clear')"
        :aria-label="t('commandHistory.clear')"
        @click="clear"
      >
        <i class="fas fa-trash-alt" aria-hidden="true"></i>
      </button>
    </div>

    <div
      data-testid="command-history-list"
      class="command-history-list-area min-h-0 flex-1 overflow-y-auto p-2"
      :style="rowStyle"
      :data-row-scale="localScale.toFixed(2)"
      @wheel="scaleRows"
    >
      <div
        v-if="loading && !filtered.length"
        class="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center text-sm text-text-secondary"
      >
        <i class="fas fa-spinner fa-spin mb-2 text-xl" aria-hidden="true"></i>
        <p>{{ t('commandHistory.loading') }}</p>
      </div>
      <p v-else-if="error" class="p-4 text-sm text-error">{{ t('commandHistory.loadFailed', { error }) }}</p>
      <div
        v-else-if="!filtered.length"
        class="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center text-sm text-text-secondary"
      >
        <i class="fas fa-history mb-2 text-xl" aria-hidden="true"></i>
        <p>{{ search ? t('commandHistory.noMatches') : t('commandHistory.empty') }}</p>
      </div>
      <div v-else class="overflow-hidden rounded-xl border border-border/60 bg-card/25 shadow-2xs">
        <ul ref="list" class="m-0 list-none p-1.5 space-y-1">
          <li
            v-for="(entry, index) in filtered"
            :key="entry.id"
            :data-history-id="entry.id"
            class="command-history-row group flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-all duration-150 hover:bg-primary/10 active:bg-primary/15"
            :class="[
              isCompact ? 'command-history-row--compact' : '',
              selectedIndex === index ? 'bg-primary/20 font-medium' : '',
            ]"
            :title="entry.command"
            @click="execute(entry)"
            @contextmenu.prevent="openContext($event, entry)"
          >
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <i
                class="fas fa-terminal text-[10px] text-text-secondary/50 group-hover:text-primary transition-colors shrink-0"
                aria-hidden="true"
              ></i>
              <button
                data-testid="command-history-execute"
                type="button"
                class="command-history-command min-w-0 flex-1 truncate text-left font-mono text-xs text-foreground group-hover:text-foreground cursor-pointer transition-colors"
                @click.stop="execute(entry)"
              >
                {{ entry.command }}
              </button>
            </div>
            <span
              v-if="entry.timestamp"
              class="command-history-timestamp shrink-0 ml-auto pl-2 text-[11px] font-mono text-text-secondary/50 transition-colors group-hover:text-text-secondary/80 select-none text-right"
              :title="formatFullDate(entry.timestamp)"
            >
              {{ formatTime(entry.timestamp) }}
            </span>
          </li>
        </ul>
      </div>
    </div>

    <BaseContextMenu v-if="context" :visible="true" :x="context.x" :y="context.y" :width="200" @close="context = null">
      <button class="context-item" @click="execute(context.entry)">
        <i class="fas fa-play" aria-hidden="true"></i>
        <span>{{ t('commandHistory.execute') }}</span>
      </button>
      <button data-testid="command-history-copy" class="context-item" @click="copy(context.entry.command)">
        <i class="fas fa-copy" aria-hidden="true"></i>
        <span>{{ t('commandHistory.copy') }}</span>
      </button>
      <button data-testid="command-history-delete" class="context-item text-error" @click="remove(context.entry.id)">
        <i class="fas fa-trash-alt" aria-hidden="true"></i>
        <span>{{ t('commandHistory.delete') }}</span>
      </button>
      <div class="my-1 border-t border-border" role="separator"></div>
      <button class="context-item" @click="execute(context.entry, true)">
        <i class="fas fa-paper-plane" aria-hidden="true"></i>
        <span>{{ t('commandHistory.actions.sendToAllSessions') }}</span>
      </button>
    </BaseContextMenu>
  </section>
</template>

<style scoped>
  .command-history-root {
    container-type: inline-size;
    container-name: command-history-pane;
    min-width: 0;
  }
  .command-history-controls {
    justify-content: center;
    gap: clamp(0.2rem, 1.25cqi, 0.5rem);
  }
  .command-history-controls,
  .command-history-list-area,
  .command-history-row {
    min-width: 0;
  }
  .command-history-row {
    min-height: calc(var(--history-row-scale) * 1.875rem);
    padding: calc(var(--history-row-scale) * 0.35rem) calc(var(--history-row-scale) * 0.6rem);
  }
  .command-history-row--compact {
    min-height: calc(var(--history-row-scale) * 1.5rem);
    padding-block: calc(var(--history-row-scale) * 0.15rem);
  }
  .command-history-command {
    min-width: 0;
  }
  @container command-history-pane (max-width: 340px) {
    .command-history-controls {
      gap: 0.25rem;
      padding: 0.35rem 0.4rem;
    }
    .command-history-search {
      padding-inline: 0.5rem;
      font-size: 0.75rem;
      height: 1.75rem;
    }
    .command-history-list-area {
      padding: 0.35rem 0.35rem;
    }
    .command-history-row {
      padding-inline: 0.45rem;
    }
  }
  @container command-history-pane (max-width: 125px) {
    .command-history-controls {
      flex-wrap: wrap;
      justify-content: center;
    }
    .command-history-search {
      flex: 1 1 100%;
      width: 100%;
    }
    .command-history-row {
      flex-wrap: nowrap;
      align-items: center;
    }
  }
  .history-control {
    display: flex;
    width: clamp(1.6rem, 8.5cqi, 1.875rem);
    height: clamp(1.6rem, 8.5cqi, 1.875rem);
    flex: 0 0 clamp(1.6rem, 8.5cqi, 1.875rem);
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
    border-radius: 0.5rem;
    color: var(--text-color-secondary);
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
    cursor: pointer;
  }
  .history-control i {
    font-size: clamp(0.72rem, 3.5cqi, 0.825rem);
  }
  .history-control:hover {
    background: var(--header-bg-color);
    color: var(--text-color);
    border-color: var(--border-color);
  }
  .history-control--danger:hover {
    border-color: color-mix(in srgb, var(--status-error-color) 60%, transparent);
    background: color-mix(in srgb, var(--status-error-color) 12%, transparent);
    color: var(--status-error-color);
  }

  .context-item {
    display: flex;
    width: calc(100% - 0.5rem);
    margin-inline: 0.25rem;
    align-items: center;
    gap: 0.75rem;
    border-radius: 0.375rem;
    padding: 0.4rem 0.75rem;
    text-align: left;
    font-size: 0.875rem;
    cursor: pointer;
  }
  .context-item:hover,
  .context-item:focus-visible {
    background: color-mix(in srgb, var(--link-active-color) 10%, transparent);
    color: var(--link-active-color);
    outline: none;
  }
  .context-item i {
    width: 1rem;
    text-align: center;
  }
</style>
