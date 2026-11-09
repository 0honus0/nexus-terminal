import { ref, toRaw } from 'vue';
import { prepareAgentEnable, installAgentRequirements } from '../plugins/api/plugin-onboarding-api';
import type { PluginEnablePlan } from '../plugins/model/plugin-onboarding-types';
import { useAgentManagementOperation } from './use-agent-management-operation';

/** Retry from real installed facts; no separate persistent onboarding state. */
export function useAgentOnboarding(options: {
	available: () => boolean;
	canEnable: () => boolean;
	onReady: () => void;
}) {
	const plan = ref<PluginEnablePlan | null>(null);
	const visible = ref(false);
	const operation = useAgentManagementOperation(() => {
		plan.value = null;
		visible.value = false;
	}, options.available);

	async function request(): Promise<void> {
		if (!options.canEnable()) return;
		await operation.execute(
			(signal) => prepareAgentEnable(signal),
			(prepared) => {
				if (!options.canEnable()) return;
				plan.value = prepared;
				if (prepared.ready) {
					visible.value = false;
					options.onReady();
					return;
				}
				visible.value = true;
			},
			{ write: false },
		);
	}

	async function confirm(): Promise<void> {
		if (!visible.value || !plan.value || operation.refreshRequired.value || !options.canEnable()) return;
		const original = structuredClone(toRaw(plan.value));
		await operation.execute(
			(signal) => installAgentRequirements(original, signal),
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
				},
			},
		);
	}

	function close(): void {
		if (!operation.busy.value) visible.value = false;
	}

	return { plan, visible, operation, request, confirm, close };
}
