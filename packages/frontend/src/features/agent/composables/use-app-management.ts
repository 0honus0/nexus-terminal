import { onActivated, onMounted, ref } from 'vue';
import { createManagedApp, listAppDefinitions, listManagedApps, setManagedAppEnabled } from '../api/app-management-api';
import type { AppDefinition, ManagedApp } from '../model/app-management-types';
import { useAgentManagementOperation } from './use-agent-management-operation';
import { agentHostEvents } from '../events/agent-host-events';

export function useAppManagement() {
	const apps = ref<ManagedApp[]>([]);
	const definitions = ref<AppDefinition[]>([]);
	const name = ref('');
	const definitionId = ref('');
	const selectedId = ref('');
	const loaded = ref(false);
	const appOperation = useAgentManagementOperation(() => {
		apps.value = [];
		name.value = '';
		definitionId.value = '';
		selectedId.value = '';
		loaded.value = false;
	});
	const definitionOperation = useAgentManagementOperation(() => {
		definitions.value = [];
		definitionId.value = '';
	});

	async function loadApps(): Promise<void> {
		await appOperation.execute(
			listManagedApps,
			(value) => {
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
		await definitionOperation.execute(
			listAppDefinitions,
			(value) => {
				definitions.value = value;
			},
			{ write: false },
		);
	}

	async function create(): Promise<void> {
		const definition = definitions.value.find((value) => value.id === definitionId.value);
		if (!definition || definitionOperation.refreshRequired.value) {
			return;
		}
		const appName = name.value;
		await appOperation.execute(
			(signal) => createManagedApp(appName, definition.id, signal),
			(value) => {
				apps.value = [...apps.value, value];
				name.value = '';
				selectedId.value = value.id;
				agentHostEvents.emit('host-changed', undefined);
			},
			{ write: true },
		);
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
		if (!loaded.value) {
			void loadApps();
			void loadDefinitions();
		}
	}

	onMounted(initial);
	onActivated(initial);
	return {
		apps,
		definitions,
		name,
		definitionId,
		selectedId,
		appOperation,
		definitionOperation,
		loadApps,
		loadDefinitions,
		create,
		toggle,
	};
}
