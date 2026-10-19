import { computed, onActivated, onMounted, ref, toRaw } from 'vue';
import {
	createManagedIntegration,
	deleteManagedIntegration,
	discoverManagedIntegration,
	getManagedIntegration,
	listManagedIntegrations,
	updateManagedIntegration,
} from '../api/integration-management-api';
import type { IntegrationDraft, IntegrationDiscovery, ManagedIntegration } from '../model/integration-types';
import { newIntegrationDraft, toIntegrationDraft } from '../model/integration-mapper';
import { useAgentManagementOperation } from './use-agent-management-operation';

export function useAppIntegrations(appId: string) {
	const items = ref<ManagedIntegration[]>([]);
	const original = ref<ManagedIntegration | null>(null);
	const draft = ref(newIntegrationDraft());
	const discovery = ref<IntegrationDiscovery | null>(null);
	const deleteId = ref<string | null>(null);
	const pendingCreate = ref(false);
	const needsReload = ref(true);
	// Keep an uncertain creation's exact input and key for explicit replay only; revoke clears both, including its secret.
	let createIntent: { key: string; draft: IntegrationDraft } | null = null;
	const operation = useAgentManagementOperation(() => {
		items.value = [];
		original.value = null;
		draft.value = newIntegrationDraft();
		discovery.value = null;
		deleteId.value = null;
		pendingCreate.value = false;
		createIntent = null;
		needsReload.value = true;
	});
	const blocked = computed(() => operation.busy.value || operation.refreshRequired.value || needsReload.value);

	async function load(): Promise<void> {
		await operation.execute(
			(signal) => listManagedIntegrations(appId, signal),
			(value) => {
				items.value = value;
				needsReload.value = false;
				original.value = null;
				draft.value = createIntent === null ? newIntegrationDraft() : structuredClone(createIntent.draft);
				draft.value.credential = '';
				discovery.value = null;
				deleteId.value = null;
			},
			{ write: false },
		);
	}

	function resetDraft(): void {
		if (blocked.value || pendingCreate.value) {
			return;
		}
		original.value = null;
		draft.value = newIntegrationDraft();
	}

	async function edit(id: string): Promise<void> {
		if (blocked.value || pendingCreate.value) {
			return;
		}
		await operation.execute(
			(signal) => getManagedIntegration(appId, id, signal),
			(value) => {
				original.value = value;
				draft.value = toIntegrationDraft(value);
			},
			{ write: false },
		);
	}

	async function save(): Promise<void> {
		if (blocked.value) {
			return;
		}
		if (original.value !== null) {
			const baseline = structuredClone(toRaw(original.value));
			const input = structuredClone(toRaw(draft.value));
			draft.value.credential = '';
			await operation.execute(
				(signal) => updateManagedIntegration(appId, baseline, input, signal),
				(value) => {
					items.value = items.value.map((item) => (item.id === value.id ? value : item));
					original.value = value;
					draft.value = toIntegrationDraft(value);
					discovery.value = null;
				},
				{ write: true },
			);
			return;
		}
		const intent = createIntent ?? { key: crypto.randomUUID(), draft: structuredClone(toRaw(draft.value)) };
		createIntent = intent;
		pendingCreate.value = true;
		draft.value.credential = '';
		await operation.execute(
			(signal) => createManagedIntegration(appId, intent.draft, intent.key, signal),
			() => {
				createIntent = null;
				pendingCreate.value = false;
				draft.value = newIntegrationDraft();
				// A replay returns the first receipt; only a fresh list can establish current configuration.
				needsReload.value = true;
			},
			{ write: true },
		);
		if (createIntent === intent && ['invalid', 'failed', 'conflict'].includes(operation.notice.value)) {
			createIntent = null;
			pendingCreate.value = false;
		}
	}

	async function remove(item: ManagedIntegration): Promise<void> {
		if (blocked.value || pendingCreate.value || deleteId.value !== item.id) {
			return;
		}
		const baseline = structuredClone(toRaw(item));
		await operation.execute(
			(signal) => deleteManagedIntegration(appId, baseline, signal),
			() => {
				items.value = items.value.filter((value) => value.id !== baseline.id);
				deleteId.value = null;
				if (original.value?.id === baseline.id) {
					original.value = null;
					draft.value = newIntegrationDraft();
				}
				if (discovery.value?.integration.id === baseline.id) {
					discovery.value = null;
				}
			},
			{ write: true },
		);
	}

	async function discover(item: ManagedIntegration): Promise<void> {
		if (blocked.value || pendingCreate.value || item.configuration.kind !== 'mcp') {
			return;
		}
		const baseline = structuredClone(toRaw(item));
		await operation.execute(
			(signal) => discoverManagedIntegration(appId, baseline, signal),
			(value) => {
				discovery.value = value;
				items.value = items.value.map((item) => (item.id === value.integration.id ? value.integration : item));
				if (original.value?.id === baseline.id) {
					original.value = null;
					draft.value = newIntegrationDraft();
				}
			},
			{ write: true },
		);
	}

	function initial(): void {
		if (needsReload.value) {
			void load();
		}
	}

	onMounted(initial);
	onActivated(initial);
	return {
		items,
		original,
		draft,
		discovery,
		deleteId,
		pendingCreate,
		needsReload,
		operation,
		blocked,
		load,
		resetDraft,
		edit,
		save,
		remove,
		discover,
	};
}
