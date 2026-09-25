import { computed, type ComputedRef } from 'vue';
import type { CommandHistoryEntryDto } from '../model/commandHistory';
import { useCommandHistoryStore } from '../store/commandHistory.store';

export interface CommandHistoryController {
  selected: ComputedRef<Readonly<CommandHistoryEntryDto> | null>;
  load(): Promise<void>;
  add(command: string): Promise<void>;
  setSearch(value: string): void;
  selectNext(): void;
  selectPrevious(): void;
  resetSelection(): void;
}

/** Public Command History capability facade. */
export function useCommandHistory(): CommandHistoryController {
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
