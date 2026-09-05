<script setup lang="ts">
  import { onBeforeUnmount, onMounted, ref } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { BaseContextMenu } from '@/foundation/ui';
  import { writeClipboardText } from '@/foundation/browser';
  import { useFeedback } from '@/shared/feedback/public';
  import { focusRegistry } from '@/shared/focus/public';
  import { useCommandHistoryStore } from '../store/commandHistory.store';
  import type { CommandHistoryEntry, ExecuteHistoryIntent } from '../model/commandHistory';

  const emit = defineEmits<{ execute: [intent: ExecuteHistoryIntent] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const store = useCommandHistoryStore();
  const { search, loading, error, filtered, selectedIndex } = storeToRefs(store);
  const searchInput = ref<HTMLInputElement | null>(null);
  const root = ref<HTMLElement | null>(null);
  const context = ref<{ entry: CommandHistoryEntry; x: number; y: number } | null>(null);
  let unregisterFocus: (() => void) | undefined;

  onMounted(() => {
    void store.load().catch(() => undefined);
    unregisterFocus = focusRegistry.register(
      'commandHistorySearch',
      () => {
        searchInput.value?.focus();
        return true;
      },
      () => Boolean(root.value?.getClientRects().length),
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
  const execute = (entry: CommandHistoryEntry, allSessions = false) => {
    context.value = null;
    emit('execute', { command: entry.command, allSessions: allSessions || undefined });
  };
  const openContext = (event: MouseEvent, entry: CommandHistoryEntry) => {
    context.value = { entry, x: event.clientX, y: event.clientY };
  };
  const revealSelected = () => {
    const entry = filtered.value[selectedIndex.value];
    if (!entry) return;
    root.value?.querySelector<HTMLElement>(`[data-history-id="${entry.id}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const handleSearchKeydown = (event: KeyboardEvent) => {
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
      const entry = filtered.value[selectedIndex.value];
      if (!entry) return;
      event.preventDefault();
      execute(entry);
    }
  };
  const handleSearchBlur = () => {
    window.setTimeout(() => {
      if (!root.value?.contains(document.activeElement)) store.resetSelection();
    }, 0);
  };
</script>

<template>
  <section
    ref="root"
    data-testid="command-history-view"
    class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
  >
    <div class="flex shrink-0 items-center gap-2 bg-background p-2">
      <input
        ref="searchInput"
        v-model="search"
        data-testid="command-history-search"
        data-focus-id="commandHistorySearch"
        type="text"
        :placeholder="t('commandHistory.searchPlaceholder')"
        class="min-w-0 flex-1 rounded-lg border border-border/50 bg-input px-4 py-1.5 text-sm text-foreground shadow-sm transition duration-150 ease-in-out focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
        @keydown="handleSearchKeydown"
        @blur="handleSearchBlur"
      />
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
      <p>{{ t('commandHistory.empty') }}</p>
    </div>
    <ul v-else class="m-0 min-h-0 flex-1 list-none overflow-y-auto p-2">
      <li
        v-for="(entry, index) in filtered"
        :key="entry.id"
        :data-history-id="entry.id"
        class="group mb-1 flex cursor-pointer items-center rounded-md px-3 py-2.5 transition-colors duration-150 hover:bg-primary/10"
        :class="selectedIndex === index ? 'bg-primary/20 font-medium' : ''"
        :title="entry.command"
        @click="execute(entry)"
        @contextmenu.prevent="openContext($event, entry)"
      >
        <button
          data-testid="command-history-execute"
          type="button"
          class="min-w-0 flex-1 truncate text-left font-mono text-sm text-foreground"
          @click.stop="execute(entry)"
        >
          {{ entry.command }}
        </button>
        <div
          class="ml-2 flex shrink-0 items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100"
        >
          <button
            data-testid="command-history-copy"
            type="button"
            class="history-row-action hover:text-primary"
            :title="t('commandHistory.copy')"
            @click.stop="copy(entry.command)"
          >
            <i class="fas fa-copy" aria-hidden="true"></i>
          </button>
          <button
            data-testid="command-history-delete"
            type="button"
            class="history-row-action hover:text-error"
            :title="t('commandHistory.delete')"
            @click.stop="remove(entry.id)"
          >
            <i class="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>
      </li>
    </ul>

    <BaseContextMenu v-if="context" :visible="true" :x="context.x" :y="context.y" :width="200" @close="context = null">
      <button class="context-item" @click="execute(context.entry, true)">
        <i class="fas fa-paper-plane" aria-hidden="true"></i>
        <span>{{ t('commandHistory.actions.sendToAllSessions') }}</span>
      </button>
    </BaseContextMenu>
  </section>
</template>

<style scoped>
  .history-control {
    display: flex;
    width: 2rem;
    height: 2rem;
    flex: 0 0 2rem;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent);
    border-radius: 0.5rem;
    color: var(--text-secondary-color);
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }
  .history-control--danger:hover {
    border-color: color-mix(in srgb, var(--error-color) 50%, transparent);
    background: color-mix(in srgb, var(--error-color) 10%, transparent);
    color: var(--error-color);
  }
  .history-row-action {
    display: inline-flex;
    width: 1.75rem;
    height: 1.75rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    color: var(--text-secondary-color);
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }
  .history-row-action:hover {
    background: color-mix(in srgb, black 10%, transparent);
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
  }
  .context-item:hover,
  .context-item:focus-visible {
    background: color-mix(in srgb, var(--primary-color) 10%, transparent);
    color: var(--primary-color);
    outline: none;
  }
  .context-item i {
    width: 1rem;
    text-align: center;
  }
</style>
