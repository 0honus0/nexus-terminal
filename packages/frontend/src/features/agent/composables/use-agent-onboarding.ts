import { ref } from 'vue';
import { getPluginRecommendation, installRecommendedPlugin } from '../api/plugin-management-api';
import type { PluginCatalogEntry } from '../model/plugin-types';
import { useAgentManagementOperation } from './use-agent-management-operation';

/** Installation and enabling are separate writes; an uncertain installation is never replayed. */
export function useAgentOnboarding(options: {
	available: () => boolean;
	canEnable: () => boolean;
	onReady: () => void;
}) {
	const entry = ref<PluginCatalogEntry | null>(null);
	const visible = ref(false);
	const uncertain = ref(false);
	let installIntent: symbol | null = null;
	const operation = useAgentManagementOperation((reason) => {
		entry.value = null;
		visible.value = false;
		if (reason === 'session' || reason === 'disposed') uncertain.value = false;
		else if (installIntent !== null) uncertain.value = true;
	}, options.available);

	async function request(): Promise<void> {
		if (!options.canEnable()) return;
		await operation.execute(
			getPluginRecommendation,
			(recommendation) => {
				if (!options.canEnable()) return;
				if (recommendation.installation?.status === 'installed') {
					uncertain.value = false;
					options.onReady();
					return;
				}
				entry.value = recommendation.entry;
				visible.value = recommendation.entry !== null;
				if (!recommendation.entry) operation.notice.value = 'failed';
			},
			{ write: false },
		);
	}

	async function confirm(): Promise<void> {
		if (!visible.value || !entry.value?.compatible || uncertain.value || !options.canEnable()) return;
		const intent = Symbol();
		installIntent = intent;
		await operation.execute(
			installRecommendedPlugin,
			() => {
				visible.value = false;
				options.onReady();
			},
			{
				write: true,
				refreshAfterSuccess: true,

				onFailure() {
					uncertain.value = operation.notice.value === 'unknown';
				},
			},
		);
		if (installIntent === intent) installIntent = null;
	}

	function close(): void {
		if (!operation.busy.value) visible.value = false;
	}

	return { entry, visible, uncertain, operation, request, confirm, close };
}
