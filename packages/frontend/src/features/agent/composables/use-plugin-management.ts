import { computed, onActivated, onMounted, ref, toRaw, watch } from 'vue';
import {
	acknowledgePluginRuntime,
	getPluginRuntime,
	installPluginStage,
	listPluginInstallations,
	listPluginPublishers,
	listPluginStages,
	listPluginVersions,
	retirePluginInstallation,
	revokePluginPublisher,
	stagePluginCatalogEntry,
	trustPluginPublisher,
	upgradePluginInstallation,
	verifyPluginStage,
} from '../api/plugin-management-api';
import type {
	PluginInstallation,
	PluginPublisher,
	PluginRuntime,
	PluginStage,
	PluginVersion,
	PluginCatalogEntry,
} from '../model/plugin-types';
import { agentHostEvents } from '../events/agent-host-events';
import { useAgentManagementOperation } from './use-agent-management-operation';

export function usePluginManagement(available: () => boolean = () => true) {
	const officialPublisherIds = ref<string[]>([]);
	const publishers = ref<PluginPublisher[]>([]);
	const installations = ref<PluginInstallation[]>([]);
	const stages = ref<PluginStage[]>([]);
	const versions = ref<PluginVersion[]>([]);
	const selectedStageId = ref('');
	const candidate = ref<PluginStage | null>(null);
	const candidateInstallation = computed(() =>
		installations.value.find(
			(item) => item.status !== 'removed' && item.definitionId === candidate.value?.manifest?.id,
		),
	);
	const label = ref('');
	const publicKeyPem = ref('');
	const runtime = ref<PluginRuntime | null>(null);
	const runtimeAppId = ref('');
	const runtimeInstanceId = ref('');
	const runtimeAcknowledged = ref(false);
	const mutationUnknown = ref(false);
	const acknowledged = ref(false);
	let writeIntent: symbol | null = null;
	const operation = useAgentManagementOperation((reason) => {
		officialPublisherIds.value = [];
		publishers.value = [];
		installations.value = [];
		stages.value = [];
		versions.value = [];
		selectedStageId.value = '';
		candidate.value = null;
		label.value = '';
		publicKeyPem.value = '';
		runtime.value = null;
		runtimeAppId.value = '';
		runtimeInstanceId.value = '';
		runtimeAcknowledged.value = false;
		mutationUnknown.value = reason === 'view' && (mutationUnknown.value || writeIntent !== null);
		acknowledged.value = false;
	}, available);

	async function load(): Promise<void> {
		await operation.execute(
			async (signal) => {
				const [publishers, installations, stages, versions] = await Promise.all([
					listPluginPublishers(signal),
					listPluginInstallations(signal),
					listPluginStages(signal),
					listPluginVersions(signal),
				]);
				return { publishers, installations, stages, versions };
			},
			(value) => {
				publishers.value = value.publishers;
				installations.value = value.installations;
				stages.value = value.stages;
				versions.value = value.versions;
				if (!value.stages.some((item) => item.id === selectedStageId.value)) {
					selectedStageId.value = '';
				}
			},
			{ write: false },
		);
	}

	function canWrite(): boolean {
		return !operation.busy.value && !operation.refreshRequired.value && !mutationUnknown.value;
	}

	async function write<T>(action: (signal: AbortSignal) => Promise<T>, accept?: (result: T) => void): Promise<void> {
		if (!canWrite()) {
			return;
		}
		const intent = Symbol();
		writeIntent = intent;
		await operation.execute(
			action,
			(value) => {
				accept?.(value);
				agentHostEvents.emit('host-changed', undefined);
			},
			{
				write: true,
				refreshAfterSuccess: true,

				onFailure() {
					mutationUnknown.value = operation.notice.value === 'unknown';
				},
			},
		);
		if (writeIntent === intent) writeIntent = null;
		if (operation.notice.value === 'saved') {
			await load();
		}
	}

	async function trust(): Promise<void> {
		const name = label.value;
		const pem = publicKeyPem.value;
		await write(
			(signal) => trustPluginPublisher(name, pem, signal),
			() => {
				label.value = '';
				publicKeyPem.value = '';
			},
		);
	}

	async function revoke(value: PluginPublisher): Promise<void> {
		const original = structuredClone(toRaw(value));
		await write((signal) => revokePluginPublisher(original, signal));
	}

	async function prepareCatalogEntry(entry: PluginCatalogEntry, source: string | null): Promise<void> {
		const original = structuredClone(toRaw(entry));
		await write(
			(signal) => stagePluginCatalogEntry(original, source, signal),
			(value) => {
				selectedStageId.value = value.id;
				candidate.value = value;
			},
		);
	}

	async function trustCatalogPublisher(name: string, pem: string): Promise<void> {
		await write((signal) => trustPluginPublisher(name, pem, signal));
	}

	async function verify(stage: PluginStage): Promise<void> {
		const original = structuredClone(toRaw(stage));
		await write((signal) => verifyPluginStage(original, signal));
	}

	async function install(stage: PluginStage): Promise<void> {
		const original = structuredClone(toRaw(stage));
		await write(
			(signal) => installPluginStage(original, signal),
			() => {
				candidate.value = null;
			},
		);
	}

	async function applyCandidate(): Promise<void> {
		const stage = candidate.value;
		if (!stage || stage.status !== 'verified') {
			return;
		}
		const installation = candidateInstallation.value;
		if (!installation) {
			await install(stage);
			return;
		}
		if (installation.status !== 'installed' && installation.status !== 'draining') {
			return;
		}
		const original = structuredClone(toRaw(installation));
		const verified = structuredClone(toRaw(stage));
		await write(
			(signal) => upgradePluginInstallation(original, verified, original.status === 'installed', signal),
			(value) => {
				if (value.status === 'installed') {
					candidate.value = null;
				}
			},
		);
	}

	async function retire(installation: PluginInstallation, cancel: boolean): Promise<void> {
		const original = structuredClone(toRaw(installation));
		await write((signal) => retirePluginInstallation(original, cancel, signal));
	}

	async function upgrade(installation: PluginInstallation, prepare: boolean): Promise<void> {
		const selected = stages.value.find((item) => item.id === selectedStageId.value);
		if (!selected || selected.status !== 'verified' || selected.manifest?.id !== installation.definitionId) {
			return;
		}
		const original = structuredClone(toRaw(installation));
		const stage = structuredClone(toRaw(selected));
		await write((signal) => upgradePluginInstallation(original, stage, prepare, signal));
	}

	async function readRuntime(): Promise<void> {
		if (operation.busy.value || operation.refreshRequired.value) {
			return;
		}
		const appId = runtimeAppId.value;
		const instanceId = runtimeInstanceId.value.trim() || null;
		await operation.execute(
			(signal) => getPluginRuntime(appId, instanceId, signal),
			(value) => {
				runtime.value = value;
				runtimeAcknowledged.value = false;
			},
			{ write: false },
		);
	}

	async function acknowledgeRuntime(): Promise<void> {
		const installation = installations.value.find((item) => item.appId === runtime.value?.appId);
		if (!runtime.value || !installation || !runtimeAcknowledged.value || runtime.value.state !== 'unknown') {
			return;
		}
		const original = structuredClone(toRaw(runtime.value));
		const current = structuredClone(toRaw(installation));
		await write(
			(signal) => acknowledgePluginRuntime(current, original, signal),
			(value) => {
				runtime.value = value;
				runtimeAcknowledged.value = false;
			},
		);
	}

	function newIntent(): void {
		if (operation.busy.value || operation.refreshRequired.value || !acknowledged.value) {
			return;
		}
		mutationUnknown.value = false;
		acknowledged.value = false;
		candidate.value = null;
		publicKeyPem.value = '';
	}

	function initial(): void {
		if (operation.refreshRequired.value) {
			void load();
		}
	}

	onMounted(initial);
	onActivated(initial);
	watch(available, (active) => {
		if (active) initial();
	});
	return {
		officialPublisherIds,
		publishers,
		installations,
		stages,
		versions,
		selectedStageId,
		candidate,
		candidateInstallation,
		applyCandidate,
		label,
		publicKeyPem,
		runtime,
		runtimeAppId,
		runtimeInstanceId,
		runtimeAcknowledged,
		mutationUnknown,
		acknowledged,
		operation,
		canWrite,
		write,
		load,
		trust,
		revoke,
		prepareCatalogEntry,
		trustCatalogPublisher,
		verify,
		install,
		retire,
		upgrade,
		readRuntime,
		acknowledgeRuntime,
		newIntent,
	};
}
