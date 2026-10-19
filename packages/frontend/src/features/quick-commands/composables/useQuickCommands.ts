import type { QuickCommandsController } from '../model/quick-command-types';
import { computed } from 'vue';
import type { QuickCommandSummary } from '../model/quick-command-types';
import { useQuickCommandsStore } from '../store/quickCommands.store';

/** Public Quick Commands capability facade for runtime composition. */
export function useQuickCommands(): QuickCommandsController {
	const store = useQuickCommandsStore();

	return {
		selected: computed<Readonly<QuickCommandSummary> | null>(() => store.selected),
		recordUsage: store.recordUsage.bind(store),
		setSearch: store.setSearch.bind(store),
		selectNext: store.selectNext.bind(store),
		selectPrevious: store.selectPrevious.bind(store),
		resetSelection: store.resetSelection.bind(store),
	};
}
