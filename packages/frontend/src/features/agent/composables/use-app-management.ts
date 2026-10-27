import { nextTick, onActivated, onMounted, ref, watch } from 'vue';
import { listAppDefinitions, listManagedApps, setManagedAppEnabled } from '../api/app-management-api';
import type { AppDefinition, ManagedApp } from '../model/app-management-types';
import { useAgentManagementOperation } from './use-agent-management-operation';
import { agentHostEvents } from '../events/agent-host-events';

export function useAppManagement(available: () => boolean = () => true) {
	const apps = ref<ManagedApp[]>([]);
	const definitions = ref<AppDefinition[]>([]);
	const selectedId = ref('');
	const loaded = ref(false);
	let appsReloadRequested = false;
	let definitionsReloadRequested = false;
	const appOperation = useAgentManagementOperation(() => {
		appsReloadRequested = false;
		apps.value = [];
		selectedId.value = '';
		loaded.value = false;
	}, available);
	const definitionOperation = useAgentManagementOperation(() => {
		definitionsReloadRequested = false;
		definitions.value = [];
	}, available);

	async function loadApps(): Promise<void> {
		if (!available()) return;
		if (appOperation.busy.value) {
			appsReloadRequested = true;
			return;
		}
		appsReloadRequested = false;
		await appOperation.execute(
			listManagedApps,
			(value) => {
				if (appsReloadRequested) return;
				apps.value = value;
				loaded.value = true;
				if (!value.some((app) => app.id === selectedId.value)) {
					selectedId.value = '';
				}
			},
			{ write: false },
		);
	}

	async function loadDefinitions(): Promise<void> {
		if (!available()) return;
		if (definitionOperation.busy.value) {
			definitionsReloadRequested = true;
			return;
		}
		definitionsReloadRequested = false;
		await definitionOperation.execute(
			listAppDefinitions,
			(value) => {
				if (definitionsReloadRequested) return;
				definitions.value = value;
			},
			{ write: false },
		);
	}

	function reload(): void {
		if (!loaded.value || !appOperation.refreshRequired.value) void loadApps();
		void loadDefinitions();
	}

	async function toggle(app: ManagedApp): Promise<void> {
		await appOperation.execute(
			(signal) => setManagedAppEnabled(app, !app.enabled, signal),
			(value) => {
				apps.value = apps.value.map((item) => (item.id === value.id ? value : item));
				agentHostEvents.emit('host-changed', undefined);
			},
			{ write: true },
		);
	}

	function initial(): void {
		if (!available()) return;
		if (!loaded.value && !appOperation.busy.value) {
			void loadApps();
		}
		if (definitionOperation.refreshRequired.value && !definitionOperation.busy.value) {
			void loadDefinitions();
		}
	}

	watch(appOperation.busy, (busy) => {
		if (busy || !appsReloadRequested) return;
		appsReloadRequested = false;
		if (!appOperation.refreshRequired.value) void loadApps();
	});
	watch(definitionOperation.busy, (busy) => {
		if (!busy && definitionsReloadRequested) void loadDefinitions();
	});
	watch(available, initial);
	onMounted(initial);
	onActivated(async () => {
		await nextTick();
		initial();
	});
	return {
		apps,
		definitions,
		selectedId,
		appOperation,
		definitionOperation,
		loadApps,
		loadDefinitions,
		reload,
		toggle,
	};
}
