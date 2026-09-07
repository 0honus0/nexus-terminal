import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { commandHistoryApi } from '../api/commandHistoryApi';
import type { CommandHistoryEntry } from '../model/commandHistory';
export const useCommandHistoryStore = defineStore('command-history', () => {
  const items = ref<CommandHistoryEntry[]>([]),
    search = ref(''),
    loading = ref(false),
    error = ref<string | null>(null),
    selectedIndex = ref(-1);
  let addQueue = Promise.resolve();
  const filtered = computed(() => {
    const term = search.value.trim().toLowerCase();
    return items.value.filter((x) => !term || x.command.toLowerCase().includes(term));
  });
  const selected = computed(() => filtered.value[selectedIndex.value] ?? null);

  watch(search, () => {
    selectedIndex.value = -1;
  });

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      items.value = [...(await commandHistoryApi.list())].sort((a, b) => b.timestamp - a.timestamp);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      loading.value = false;
    }
  }
  function add(command: string) {
    const value = command.trim();
    if (!value || value === '\x03') return Promise.resolve();
    const operation = addQueue.then(async () => {
      error.value = null;
      try {
        await commandHistoryApi.add(value);
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        throw cause;
      }
      await load().catch(() => undefined);
    });
    addQueue = operation.catch(() => undefined);
    return operation;
  }
  async function remove(id: number) {
    error.value = null;
    try {
      await commandHistoryApi.remove(id);
      items.value = items.value.filter((x) => x.id !== id);
      if (selectedIndex.value >= filtered.value.length) selectedIndex.value = filtered.value.length - 1;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    }
  }
  async function clear() {
    error.value = null;
    try {
      await commandHistoryApi.clear();
      items.value = [];
      selectedIndex.value = -1;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
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
