import { computed } from 'vue';
import type { QuickCommand } from '../model/quickCommand';
import { useQuickCommandsStore } from '../store/quickCommands.store';

/** Public Quick Commands capability facade for runtime composition. */
export function useQuickCommands() {
  const store = useQuickCommandsStore();

  return {
    selected: computed<Readonly<QuickCommand> | null>(() => store.selected),
    recordUsage: store.recordUsage.bind(store),
    setSearch: store.setSearch.bind(store),
    selectNext: store.selectNext.bind(store),
    selectPrevious: store.selectPrevious.bind(store),
    resetSelection: store.resetSelection.bind(store),
  };
}
