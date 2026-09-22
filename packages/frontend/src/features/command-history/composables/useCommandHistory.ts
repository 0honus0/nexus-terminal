import { computed } from 'vue';
import type { CommandHistoryEntryDto } from '../model/commandHistory';
import { useCommandHistoryStore } from '../store/commandHistory.store';

/** Public Command History capability facade. */
export function useCommandHistory() {
  const store = useCommandHistoryStore();

  return {
    selected: computed<Readonly<CommandHistoryEntryDto> | null>(() => store.selected),
    load: store.load.bind(store),
    add: store.add.bind(store),
    setSearch: store.setSearch.bind(store),
    selectNext: store.selectNext.bind(store),
    selectPrevious: store.selectPrevious.bind(store),
    resetSelection: store.resetSelection.bind(store),
  };
}
