import { computed, onActivated, onMounted, ref, toRaw } from 'vue';
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
	stagePluginArtifact,
	trustPluginPublisher,
	upgradePluginInstallation,
	verifyPluginStage,
} from '../api/plugin-management-api';
import { beginManagedArtifact, uploadManagedArtifact } from '../api/artifact-management-api';
import type {
	PluginInstallation,
	PluginPublisher,
	PluginRuntime,
	PluginStage,
	PluginVersion,
} from '../model/plugin-types';
import type { ManagedArtifact } from '../model/artifact-types';
import { agentHostEvents } from '../events/agent-host-events';
import { useAgentManagementOperation } from './use-agent-management-operation';

export function usePluginManagement() {
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
	const uploadReservation = ref<ManagedArtifact | null>(null);
	const uploadAppId = ref('');
	const file = ref<File | null>(null);
	const operation = useAgentManagementOperation(() => {
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
		mutationUnknown.value = false;
		acknowledged.value = false;
		uploadReservation.value = null;
		uploadAppId.value = '';
		file.value = null;
	});

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

	async function preparePackage(): Promise<void> {
		if (!file.value || !uploadAppId.value) {
			return;
		}
		const source = file.value;
		const appId = uploadAppId.value;
		await write(
			async (signal) => {
				const reserved = await beginManagedArtifact(appId, source, signal);
				if (!signal.aborted) {
					uploadReservation.value = reserved;
				}
				const artifact = await uploadManagedArtifact(reserved, source, signal);
				if (!signal.aborted) {
					uploadReservation.value = artifact;
				}
				const stage = await stagePluginArtifact(artifact, signal);
				return verifyPluginStage(stage, signal);
			},
			(value) => {
				selectedStageId.value = value.id;
				candidate.value = value;
				file.value = null;
			},
		);
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
		file.value = null;
		publicKeyPem.value = '';
	}

	function initial(): void {
		if (operation.refreshRequired.value) {
			void load();
		}
	}

	onMounted(initial);
	onActivated(initial);
	return {
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
		uploadReservation,
		uploadAppId,
		file,
		operation,
		canWrite,
		write,
		load,
		trust,
		revoke,
		preparePackage,
		verify,
		install,
		retire,
		upgrade,
		readRuntime,
		acknowledgeRuntime,
		newIntent,
	};
}
