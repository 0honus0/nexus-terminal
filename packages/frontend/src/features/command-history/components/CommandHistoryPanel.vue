<script setup lang="ts">
  import { onBeforeUnmount, onMounted, ref } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseInput, BaseSpinner } from '@/foundation/ui';
  import { writeClipboardText } from '@/foundation/browser';
  import { useFeedback } from '@/shared/feedback/public';
  import { focusRegistry } from '@/shared/focus/public';
  import { useCommandHistoryStore } from '../store/commandHistory.store';
  import type { ExecuteHistoryIntent } from '../model/commandHistory';
  const emit = defineEmits<{ execute: [intent: ExecuteHistoryIntent] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const store = useCommandHistoryStore();
  const { search, loading, error, filtered, selectedIndex } = storeToRefs(store);
  const searchInput = ref<{ focus?: () => void } | null>(null);
  const root = ref<HTMLElement | null>(null);
  let unregisterFocus: (() => void) | undefined;
  onMounted(() => {
    void store.load().catch(() => undefined);
    unregisterFocus = focusRegistry.register(
      'commandHistorySearch',
      () => {
        searchInput.value?.focus?.();
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
    try {
      await store.remove(id);
    } catch (cause) {
      feedback.notifyError(
        t('commandHistory.deleteFailed', { error: cause instanceof Error ? cause.message : String(cause) }),
      );
    }
  };
  const copy = async (command: string) => {
    try {
      await writeClipboardText(command);
      feedback.notifySuccess(t('commandHistory.copied'));
    } catch {
      feedback.notifyError(t('commandHistory.copyFailed'));
    }
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
      emit('execute', { command: entry.command });
    }
  };
  const handleSearchBlur = () => {
    window.setTimeout(() => {
      if (!root.value?.contains(document.activeElement)) store.resetSelection();
    }, 0);
  };
</script>
<template>
  <section ref="root" data-testid="command-history-view" class="flex min-h-0 flex-1 flex-col">
    <div class="flex gap-2 border-b border-border p-3">
      <BaseInput
        ref="searchInput"
        v-model="search"
        data-testid="command-history-search"
        :placeholder="t('commandHistory.searchPlaceholder')"
        @keydown="handleSearchKeydown"
        @blur="handleSearchBlur"
      /><BaseButton variant="danger" @click="clear">{{ t('commandHistory.clear') }}</BaseButton>
    </div>
    <BaseSpinner v-if="loading" class="m-6" />
    <p v-else-if="error" class="p-4 text-sm text-error">{{ t('commandHistory.loadFailed', { error }) }}</p>
    <ul v-else class="min-h-0 flex-1 divide-y divide-border overflow-auto">
      <li
        v-for="(entry, index) in filtered"
        :key="entry.id"
        :data-history-id="entry.id"
        class="flex items-center gap-2 p-3"
        :class="selectedIndex === index ? 'bg-primary/10' : ''"
      >
        <button
          data-testid="command-history-execute"
          class="min-w-0 flex-1 truncate text-left font-mono text-sm"
          @click="emit('execute', { command: entry.command })"
        >
          {{ entry.command }}</button
        ><BaseButton data-testid="command-history-copy" size="sm" @click="copy(entry.command)">{{
          t('commandHistory.copy')
        }}</BaseButton
        ><BaseButton size="sm" @click="emit('execute', { command: entry.command, allSessions: true })">{{
          t('common.all')
        }}</BaseButton
        ><BaseButton data-testid="command-history-delete" size="sm" variant="danger" @click="remove(entry.id)">{{
          t('commandHistory.delete')
        }}</BaseButton>
      </li>
      <li v-if="!filtered.length" class="p-6 text-center text-text-secondary">{{ t('commandHistory.empty') }}</li>
    </ul>
  </section>
</template>
