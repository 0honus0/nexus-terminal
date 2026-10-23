import { nextTick, computed, onActivated, onMounted, ref, toRaw, watch } from 'vue';
import {
	createManagedIntegration,
	deleteManagedIntegration,
	discoverManagedIntegration,
	getManagedIntegration,
	listManagedIntegrations,
	updateManagedIntegration,
} from '../api/integration-management-api';
import type { IntegrationDraft, IntegrationDiscovery, ManagedIntegration } from '../model/integration-types';
import { AgentManagementFailure } from '../model/management-failure';
import { newIntegrationDraft, toIntegrationDraft } from '../model/integration-mapper';
import { useAgentManagementOperation } from './use-agent-management-operation';

export function useAppIntegrations(appId: string, available: () => boolean = () => true) {
	const items = ref<ManagedIntegration[]>([]);
	const editorOpen = ref(false);
	const original = ref<ManagedIntegration | null>(null);
	const draft = ref(newIntegrationDraft());
	const discovery = ref<IntegrationDiscovery | null>(null);
	const deleteId = ref<string | null>(null);
	const pendingCreate = ref(false);
	const needsReload = ref(true);
	// View hiding retains an uncertain creation; identity loss or disposal clears its input and key.
	let createIntent: { key: string; draft: IntegrationDraft } | null = null;
	const operation = useAgentManagementOperation((reason) => {
		items.value = [];
		original.value = null;
		draft.value = newIntegrationDraft();
		discovery.value = null;
		deleteId.value = null;
		editorOpen.value = false;
		if (reason !== 'view') {
			createIntent = null;
		}
		pendingCreate.value = createIntent !== null;
		needsReload.value = true;
	}, available);
	const blocked = computed(() => operation.busy.value || operation.refreshRequired.value || needsReload.value);

	async function load(): Promise<void> {
		await operation.execute(
			(signal) => listManagedIntegrations(appId, signal),
			(value) => {
				items.value = value;
				needsReload.value = false;
				original.value = null;
				if (createIntent === null) {
					editorOpen.value = false;
				}
				draft.value = createIntent === null ? newIntegrationDraft() : structuredClone(createIntent.draft);
				draft.value.credential = '';
				discovery.value = null;
				deleteId.value = null;
			},
			{ write: false },
		);
	}

	function closeEditor(): void {
		if (operation.busy.value || pendingCreate.value) {
			return;
		}
		editorOpen.value = false;
		original.value = null;
		draft.value = newIntegrationDraft();
	}

	function resetDraft(): void {
		if (blocked.value || pendingCreate.value) {
			return;
		}
		original.value = null;
		draft.value = newIntegrationDraft();
		editorOpen.value = true;
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
				editorOpen.value = true;
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
					original.value = null;
					draft.value = newIntegrationDraft();
					discovery.value = null;
					editorOpen.value = false;
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
				editorOpen.value = false;
				draft.value = newIntegrationDraft();
				// A replay returns the first receipt; only a fresh list can establish current configuration.
				needsReload.value = true;
			},
			{
				write: true,

				onFailure(cause) {
					if (
						createIntent === intent &&
						cause instanceof AgentManagementFailure &&
						cause.outcome !== 'unknown'
					) {
						createIntent = null;
						pendingCreate.value = false;
					}
				},
			},
		);
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

	async function toggle(item: ManagedIntegration): Promise<void> {
		if (blocked.value || pendingCreate.value || original.value !== null) return;
		const baseline = structuredClone(toRaw(item));
		const input = toIntegrationDraft(baseline);
		input.enabled = !baseline.enabled;
		await operation.execute(
			(signal) => updateManagedIntegration(appId, baseline, input, signal),
			(value) => {
				items.value = items.value.map((item) => (item.id === value.id ? value : item));
				if (discovery.value?.integration.id === value.id) discovery.value = null;
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
		if (available() && needsReload.value) {
			void load();
		}
	}

	watch(available, initial);
	onMounted(initial);
	onActivated(async () => {
		await nextTick();
		initial();
	});
	return {
		items,
		editorOpen,
		closeEditor,
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
		toggle,
	};
}
