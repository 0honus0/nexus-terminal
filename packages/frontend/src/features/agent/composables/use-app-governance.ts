import { onActivated, onMounted, ref, toRaw, watch } from 'vue';
import { getAppExecutionPolicy, getAppGrants, saveAppExecutionPolicy, saveAppGrants } from '../api/app-management-api';
import type { AppExecutionPolicy, AppGrantInput, AppGrants, AppPolicyOverrides } from '../model/app-management-types';
import { useAgentManagementOperation } from './use-agent-management-operation';
import { agentHostEvents } from '../events/agent-host-events';

/** The keyed App editor owns one instance; switching apps destroys its old request scope. */
export function useAppGovernance(appId: string, section: 'grants' | 'policy', available: () => boolean = () => true) {
	const grants = ref<AppGrants | null>(null);
	const grantDraft = ref<AppGrantInput[]>([]);
	const policy = ref<AppExecutionPolicy | null>(null);
	const policyDraft = ref<AppPolicyOverrides>({});
	const grantOperation = useAgentManagementOperation(() => {
		grants.value = null;
		grantDraft.value = [];
	}, available);
	const policyOperation = useAgentManagementOperation(() => {
		policy.value = null;
		policyDraft.value = {};
	}, available);

	function acceptGrants(value: AppGrants): void {
		grants.value = value;
		grantDraft.value = value.grants.map((grant) => ({
			capability: grant.capability,
			scope: structuredClone(toRaw(grant.scope)),
		}));
	}

	function acceptPolicy(value: AppExecutionPolicy): void {
		policy.value = value;
		policyDraft.value = structuredClone(toRaw(value.overrides));
	}

	async function loadGrants(): Promise<void> {
		await grantOperation.execute((signal) => getAppGrants(appId, signal), acceptGrants, { write: false });
	}

	async function loadPolicy(): Promise<void> {
		await policyOperation.execute((signal) => getAppExecutionPolicy(appId, signal), acceptPolicy, { write: false });
	}

	async function saveGrants(): Promise<void> {
		if (!grants.value) {
			return;
		}
		const revision = grants.value.revision;
		const input = structuredClone(toRaw(grantDraft.value));
		await grantOperation.execute(
			(signal) => saveAppGrants(appId, revision, input, signal),
			(value) => {
				acceptGrants(value);
				agentHostEvents.emit('configuration-changed', { origin: 'local' });
			},
			{ write: true },
		);
	}

	async function savePolicy(): Promise<void> {
		if (!policy.value) {
			return;
		}
		const version = policy.value.version;
		const input = structuredClone(toRaw(policyDraft.value));
		await policyOperation.execute(
			(signal) => saveAppExecutionPolicy(appId, version, input, signal),
			(value) => {
				acceptPolicy(value);
				agentHostEvents.emit('configuration-changed', { origin: 'local' });
			},
			{ write: true },
		);
	}

	function initial(): void {
		if (!available()) return;
		if (section === 'grants' && grants.value === null) {
			void loadGrants();
		}
		if (section === 'policy' && policy.value === null) {
			void loadPolicy();
		}
	}

	watch(available, initial);
	onMounted(initial);
	onActivated(initial);
	return {
		grants,
		grantDraft,
		policy,
		policyDraft,
		grantOperation,
		policyOperation,
		loadGrants,
		loadPolicy,
		saveGrants,
		savePolicy,
	};
}
