import { ref, toRaw } from 'vue';
import {
	getPluginRecommendation,
	preparePluginInstallPlan,
	executePluginInstallPlan,
} from '../plugins/api/plugin-management-api';
import type { PluginCatalogEntry } from '../plugins/model/plugin-types';
import type { PluginInstallPlan } from '../plugins/model/plugin-install-plan-types';
import { useAgentManagementOperation } from './use-agent-management-operation';

/** Signed dependencies are prepared before confirmation; retries reconcile actual packages and App bindings. */
export function useAgentOnboarding(options: {
	available: () => boolean;
	canEnable: () => boolean;
	onReady: () => void;
}) {
	const entry = ref<PluginCatalogEntry | null>(null);
	const plan = ref<PluginInstallPlan | null>(null);
	const visible = ref(false);
	const operation = useAgentManagementOperation(() => {
		entry.value = null;
		plan.value = null;
		visible.value = false;
	}, options.available);

	async function request(): Promise<void> {
		if (!options.canEnable()) return;
		await operation.execute(
			async (signal) => {
				const recommendation = await getPluginRecommendation(signal);
				const prepared =
					recommendation.installation || !recommendation.entry
						? null
						: await preparePluginInstallPlan(recommendation.entry, null, signal);
				return { recommendation, prepared };
			},
			({ recommendation, prepared }) => {
				if (!options.canEnable()) return;
				if (recommendation.installation?.status === 'installed') {
					options.onReady();
					return;
				}
				entry.value = recommendation.entry;
				plan.value = prepared;
				visible.value = recommendation.entry !== null && prepared !== null;
				if (!recommendation.entry) operation.notice.value = 'failed';
			},
			{ write: false },
		);
	}

	async function confirm(): Promise<void> {
		if (!visible.value || !entry.value?.compatible || !plan.value || !options.canEnable()) return;
		const original = structuredClone(toRaw(plan.value));
		await operation.execute(
			(signal) => executePluginInstallPlan(original, signal, 'declared_grants'),
			() => {
				visible.value = false;
				plan.value = null;
				options.onReady();
			},
			{
				write: true,
				refreshAfterSuccess: true,

				onFailure() {
					plan.value = null;
					operation.notice.value = 'failed';
				},
			},
		);
	}

	function close(): void {
		if (!operation.busy.value) visible.value = false;
	}

	return { entry, plan, visible, operation, request, confirm, close };
}
