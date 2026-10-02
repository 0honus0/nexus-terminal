import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { commandHistoryApi } from '../api/commandHistoryApi';
import type { CommandHistoryEntryDto } from '../model/commandHistory';
export const useCommandHistoryStore = defineStore('command-history', () => {
  const items = ref<CommandHistoryEntryDto[]>([]),
    search = ref(''),
    loading = ref(false),
    error = ref<string | null>(null),
    selectedIndex = ref(-1);
  let addQueue = Promise.resolve();
  let generation = 0;
  function reset() {
    generation += 1;
    items.value = [];
    search.value = '';
    loading.value = false;
    error.value = null;
    selectedIndex.value = -1;
    addQueue = Promise.resolve();
  }
  const filtered = computed(() => {
    const term = search.value.trim().toLowerCase();
    return items.value.filter((x) => !term || x.command.toLowerCase().includes(term));
  });
  const selected = computed(() => filtered.value[selectedIndex.value] ?? null);

  watch(search, () => {
    selectedIndex.value = -1;
  });

  async function load() {
    const epoch = generation;
    loading.value = true;
    error.value = null;
    try {
      const next = [...(await commandHistoryApi.list())].sort((a, b) => b.timestamp - a.timestamp);
      if (epoch === generation) items.value = next;
    } catch (cause) {
      if (epoch === generation) error.value = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      if (epoch === generation) loading.value = false;
    }
  }
  function add(command: string) {
    const epoch = generation;
    const value = command.trim();
    if (!value || value === '\x03') return Promise.resolve();
    const operation = addQueue.then(async () => {
      if (epoch !== generation) return;
      error.value = null;
      try {
        await commandHistoryApi.add(value);
      } catch (cause) {
        if (epoch === generation) error.value = cause instanceof Error ? cause.message : String(cause);
        throw cause;
      }
      if (epoch === generation) await load().catch(() => undefined);
    });
    addQueue = operation.catch(() => undefined);
    return operation;
  }
  async function remove(id: number) {
    const epoch = generation;
    error.value = null;
    try {
      await commandHistoryApi.remove(id);
      if (epoch !== generation) return;
      items.value = items.value.filter((x) => x.id !== id);
      if (selectedIndex.value >= filtered.value.length) selectedIndex.value = filtered.value.length - 1;
    } catch (cause) {
      if (epoch === generation) error.value = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    }
  }
  async function clear() {
    const epoch = generation;
    error.value = null;
    try {
      await commandHistoryApi.clear();
      if (epoch !== generation) return;
      items.value = [];
      selectedIndex.value = -1;
    } catch (cause) {
      if (epoch === generation) error.value = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    }
  }
  function setSearch(value: string) {
    search.value = value;
  }
  function selectNext() {
    if (!filtered.value.length) {
      selectedIndex.value = -1;
      return;
    }
    selectedIndex.value = (selectedIndex.value + 1) % filtered.value.length;
  }
  function selectPrevious() {
    if (!filtered.value.length) {
      selectedIndex.value = -1;
      return;
    }
    selectedIndex.value = (selectedIndex.value - 1 + filtered.value.length) % filtered.value.length;
  }
  function resetSelection() {
    selectedIndex.value = -1;
  }
  return {
    reset,
    items,
    search,
    loading,
    error,
    filtered,
    selectedIndex,
    selected,
    load,
    add,
    remove,
    clear,
    setSearch,
    selectNext,
    selectPrevious,
    resetSelection,
  };
});
registerAuthenticatedSessionReset('command-history-cache', () => useCommandHistoryStore().reset());
