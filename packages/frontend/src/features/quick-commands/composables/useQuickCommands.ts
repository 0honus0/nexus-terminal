import { computed, type ComputedRef } from 'vue';
import type { QuickCommandDto } from '../model/quickCommand';
import { useQuickCommandsStore } from '../store/quickCommands.store';

export interface QuickCommandsController {
  selected: ComputedRef<Readonly<QuickCommandDto> | null>;
  recordUsage(id: number): Promise<void>;
  setSearch(value: string): void;
  selectNext(grouped?: boolean): void;
  selectPrevious(grouped?: boolean): void;
  resetSelection(): void;
}

/** Public Quick Commands capability facade for runtime composition. */
export function useQuickCommands(): QuickCommandsController {
  const store = useQuickCommandsStore();

  return {
    selected: computed<Readonly<QuickCommandDto> | null>(() => store.selected),
    recordUsage: store.recordUsage.bind(store),
    setSearch: store.setSearch.bind(store),
    selectNext: store.selectNext.bind(store),
    selectPrevious: store.selectPrevious.bind(store),
    resetSelection: store.resetSelection.bind(store),
  };
}
