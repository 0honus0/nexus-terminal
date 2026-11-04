import { nextTick, computed, onActivated, onMounted, ref, toRaw, watch } from 'vue';
import {
	installPluginStage,
	listPluginInstallations,
	listPluginPublishers,
	listPluginVersions,
	retirePluginInstallation,
	revokePluginPublisher,
	stagePluginCatalogEntry,
	trustPluginPublisher,
	upgradePluginInstallation,
} from '../api/plugin-management-api';
import type {
	PluginInstallation,
	PluginPublisher,
	PluginStage,
	PluginVersion,
	PluginCatalogEntry,
} from '../model/plugin-types';
import { agentHostEvents } from '../events/agent-host-events';
import { useAgentManagementOperation } from './use-agent-management-operation';
import { purgePluginData } from '../api/plugin-data-api';

export function usePluginManagement(available: () => boolean = () => true) {
	const officialPublisherIds = ref<string[]>([]);
	const publishers = ref<PluginPublisher[]>([]);
	const installations = ref<PluginInstallation[]>([]);
	const retainedAppIds = ref<string[]>([]);
	let cleanupIntent: { appId: string; expectedRevision: number; operationId: string } | null = null;
	const versions = ref<PluginVersion[]>([]);
	const candidate = ref<PluginStage | null>(null);
	const candidateInstallation = computed(() =>
		installations.value.find(
			(item) => item.status !== 'removed' && item.definitionId === candidate.value?.manifest?.id,
		),
	);
	const label = ref('');
	const publicKeyPem = ref('');
	const mutationUnknown = ref(false);
	const acknowledged = ref(false);
	let writeIntent: symbol | null = null;
	const operation = useAgentManagementOperation((reason) => {
		officialPublisherIds.value = [];
		publishers.value = [];
		installations.value = [];
		retainedAppIds.value = [];
		if (reason !== 'view') cleanupIntent = null;
		versions.value = [];
		candidate.value = null;
		label.value = '';
		publicKeyPem.value = '';
		mutationUnknown.value = reason === 'view' && (mutationUnknown.value || writeIntent !== null);
		acknowledged.value = false;
	}, available);

	async function load(): Promise<void> {
		await operation.execute(
			async (signal) => {
				const [publishers, installations, versions] = await Promise.all([
					listPluginPublishers(signal),
					listPluginInstallations(signal),
					listPluginVersions(signal),
				]);
				return { publishers, installations, versions };
			},
			(value) => {
				publishers.value = value.publishers;
				// Installation revisions cover package, lifecycle and retained-data changes.
				// Re-reading the same snapshot must not invalidate the App directory.
				const changed =
					value.installations.installations.length !== installations.value.length ||
					value.installations.installations.some((item, index) => {
						const current = installations.value[index];
						return current?.appId !== item.appId || current.revision !== item.revision;
					});
				if (changed) installations.value = value.installations.installations;
				retainedAppIds.value = value.installations.retainedAppIds;
				versions.value = value.versions;
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
				const current = installations.value.find(
					(item) =>
						item.status === 'installed' &&
						item.definitionId === value.manifest?.id &&
						item.version === value.manifest.version &&
						item.packageHash === value.packageHash,
				);
				candidate.value = current ? null : value;
			},
		);
	}

	async function trustCatalogPublisher(name: string, pem: string): Promise<void> {
		await write((signal) => trustPluginPublisher(name, pem, signal));
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
		if (!stage || (stage.status !== 'verified' && stage.status !== 'installed')) {
			return;
		}
		const installation = candidateInstallation.value;
		if (
			installation?.status === 'installed' &&
			installation.version === stage.manifest?.version &&
			installation.packageHash === stage.packageHash
		) {
			candidate.value = null;
			return;
		}
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

	async function retire(installation: PluginInstallation, cancel: boolean, clearData = false): Promise<void> {
		const original = structuredClone(toRaw(installation));
		let removalConfirmed = false;
		let completed = false;
		await write(async (signal) => {
			const result = await retirePluginInstallation(original, cancel, signal);
			if (!cancel) {
				removalConfirmed = true;
				if (clearData && !signal.aborted) {
					const intent = {
						appId: result.appId,
						expectedRevision: result.revision,
						operationId: crypto.randomUUID(),
					};
					cleanupIntent = intent;
					await purgePluginData(result.appId, result.revision, intent.operationId, signal);
					if (cleanupIntent === intent) cleanupIntent = null;
				}
			}
			completed = true;
			return result;
		});
		// Removal may have committed even when the separate cleanup failed. Reconcile
		// reads only; the retained-data action owns any explicitly requested retry.
		if (removalConfirmed && !completed) {
			agentHostEvents.emit('host-changed', undefined);
			await load();
		}
	}

	async function clearData(installation: PluginInstallation): Promise<void> {
		if (installation.status !== 'removed' || !canWrite()) return;
		if (cleanupIntent?.appId !== installation.appId || cleanupIntent.expectedRevision !== installation.revision) {
			cleanupIntent = {
				appId: installation.appId,
				expectedRevision: installation.revision,
				operationId: crypto.randomUUID(),
			};
		}
		const intent = cleanupIntent;
		await write(
			(signal) => purgePluginData(intent.appId, intent.expectedRevision, intent.operationId, signal),
			() => {
				cleanupIntent = null;
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
	onActivated(async () => {
		await nextTick();
		initial();
	});
	watch(available, (active) => {
		if (active) initial();
	});
	return {
		officialPublisherIds,
		publishers,
		installations,
		retainedAppIds,
		versions,
		candidate,
		candidateInstallation,
		applyCandidate,
		label,
		publicKeyPem,
		mutationUnknown,
		acknowledged,
		operation,
		canWrite,
		load,
		trust,
		revoke,
		prepareCatalogEntry,
		trustCatalogPublisher,
		retire,
		clearData,
		newIntent,
	};
}
