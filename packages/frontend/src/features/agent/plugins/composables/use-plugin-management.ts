import type { PluginInstallPlan } from '../model/plugin-install-plan-types';
import { nextTick, computed, onActivated, onMounted, ref, toRaw, watch } from 'vue';
import {
	listPluginInstallations,
	preparePluginPackageUpdate,
	updatePluginPackage,
	cancelPluginPackageUpdate,
	listPluginPackageInstallations,
	retirePluginPackage,
	listPluginPublishers,
	listPluginVersions,
	retirePluginInstallation,
	revokePluginPublisher,
	preparePluginInstallPlan,
	executePluginInstallPlan,
	trustPluginPublisher,
} from '../api/plugin-management-api';
import type {
	PluginInstallation,
	PluginPackageInstallation,
	PluginPublisher,
	PluginStage,
	PluginVersion,
	PluginCatalogEntry,
} from '../model/plugin-types';
import { agentHostEvents } from '../../events/agent-host-events';
import { useAgentManagementOperation } from '../../composables/use-agent-management-operation';
import { AgentManagementFailure } from '../../model/management-failure';
import { purgePluginData } from '../api/plugin-data-api';

export function usePluginManagement(available: () => boolean = () => true) {
	const officialPublisherIds = ref<string[]>([]);
	const publishers = ref<PluginPublisher[]>([]);
	const installations = ref<PluginInstallation[]>([]);
	const packageInstallations = ref<PluginPackageInstallation[]>([]);
	const retainedPackageIds = ref<string[]>([]);
	const retainedAppIds = ref<string[]>([]);
	let cleanupIntent: { appId: string; expectedRevision: number; operationId: string } | null = null;
	const versions = ref<PluginVersion[]>([]);
	const candidate = ref<PluginStage | null>(null);
	const candidatePlan = ref<PluginInstallPlan | null>(null);
	const installationPlanIncomplete = ref(false);
	let retryableWrite = false;
	const candidateCapabilities = computed(() => [
		...new Set([
			...(candidate.value?.manifest?.capabilities ?? []),
			...(candidatePlan.value?.dependencies.flatMap((dependency) =>
				dependency.kind === 'installed'
					? dependency.manifest.capabilities
					: dependency.stage.manifest.capabilities,
			) ?? []),
		]),
	]);
	const candidateInstallation = computed(() =>
		packageInstallations.value.find(
			(item) =>
				item.status !== 'removed' &&
				item.packageId === candidate.value?.manifest?.id &&
				item.publisherKeyId === candidate.value?.publisherKeyId,
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
		packageInstallations.value = [];
		retainedPackageIds.value = [];
		retainedAppIds.value = [];
		if (reason !== 'view') cleanupIntent = null;
		versions.value = [];
		candidate.value = null;
		candidatePlan.value = null;
		installationPlanIncomplete.value = false;
		label.value = '';
		publicKeyPem.value = '';
		mutationUnknown.value =
			reason === 'view' && (mutationUnknown.value || (writeIntent !== null && !retryableWrite));
		acknowledged.value = false;
	}, available);

	async function load(): Promise<void> {
		await operation.execute(
			async (signal) => {
				const [publishers, installations, versions, packages] = await Promise.all([
					listPluginPublishers(signal),
					listPluginInstallations(signal),
					listPluginVersions(signal),
					listPluginPackageInstallations(signal),
				]);
				return { publishers, installations, versions, packages };
			},
			(value) => {
				publishers.value = value.publishers;
				packageInstallations.value = value.packages.installations;
				retainedPackageIds.value = value.packages.retainedPackageIds;
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

	async function write<T>(
		action: (signal: AbortSignal) => Promise<T>,
		accept?: (result: T) => void,
		retryableInstallation = false,
	): Promise<void> {
		if (!canWrite()) {
			return;
		}
		const intent = Symbol();
		writeIntent = intent;
		retryableWrite = retryableInstallation;
		let failed = false;
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
					failed = true;
					mutationUnknown.value = !retryableInstallation && operation.notice.value === 'unknown';
					if (retryableInstallation) {
						candidate.value = null;
						candidatePlan.value = null;
						installationPlanIncomplete.value = true;
					}
				},
			},
		);
		if (writeIntent === intent) {
			writeIntent = null;
			retryableWrite = false;
		}
		if (operation.notice.value === 'saved' || (retryableInstallation && failed)) {
			if (failed) agentHostEvents.emit('host-changed', undefined);
			await load();
		}
	}

	async function trust(): Promise<boolean> {
		const name = label.value;
		const pem = publicKeyPem.value;
		let confirmed = false;
		await write(
			(signal) => trustPluginPublisher(name, pem, signal),
			() => {
				confirmed = true;
				label.value = '';
				publicKeyPem.value = '';
			},
		);
		return confirmed;
	}

	async function revoke(value: PluginPublisher): Promise<void> {
		const original = structuredClone(toRaw(value));
		await write((signal) => revokePluginPublisher(original, signal));
	}

	async function prepareCatalogEntry(entry: PluginCatalogEntry, source: string | null): Promise<void> {
		const original = structuredClone(toRaw(entry));
		await write(
			(signal) => preparePluginInstallPlan(original, source, signal),
			(plan) => {
				candidatePlan.value = plan;
				installationPlanIncomplete.value = false;
				const value = plan.target.stage;
				const current = packageInstallations.value.find(
					(item) =>
						item.status === 'installed' &&
						item.publisherKeyId === value.publisherKeyId &&
						item.packageId === value.manifest?.id &&
						item.version === value.manifest?.version &&
						item.packageHash === value.packageHash,
				);
				const composed =
					value.manifest?.appContribution === null ||
					installations.value.some(
						(item) =>
							item.definitionId === value.manifest?.id &&
							item.publisherKeyId === value.publisherKeyId &&
							item.status !== 'removed',
					);
				candidate.value = current && composed ? null : value;
			},
			true,
		);
	}

	async function trustCatalogPublisher(name: string, pem: string): Promise<void> {
		await write((signal) => trustPluginPublisher(name, pem, signal));
	}

	async function applyCandidate(): Promise<void> {
		const plan = candidatePlan.value;
		if (!candidate.value || !plan) return;
		const original = structuredClone(toRaw(plan));
		const current = candidateInstallation.value;
		if (
			(current?.status === 'installed' || current?.status === 'draining') &&
			current.packageHash !== original.target.stage.packageHash &&
			original.target.stage.manifest.appContribution === null
		) {
			const installed = structuredClone(toRaw(current));
			const initialPackages = structuredClone(toRaw(packageInstallations.value));
			await write(
				async (signal) => {
					const prepared = await preparePluginPackageUpdate(installed, original.target.stage, signal);
					if (
						prepared.dependencies.some(
							(dependency) =>
								!initialPackages.some(
									(item) =>
										item.status === 'installed' &&
										item.packageId === dependency.package.packageId &&
										item.version === dependency.package.version &&
										item.packageHash === dependency.package.packageHash &&
										item.publisherKeyId === dependency.package.publisherKeyId &&
										item.revision === dependency.installationRevision,
								),
						)
					) {
						throw new AgentManagementFailure('version_conflict', 'confirmed');
					}
					return updatePluginPackage(prepared, original.target.stage, signal);
				},
				() => {
					candidate.value = null;
					candidatePlan.value = null;
					installationPlanIncomplete.value = false;
				},
				true,
			);
			return;
		}
		await write(
			(signal) => executePluginInstallPlan(original, signal),
			() => {
				candidate.value = null;
				candidatePlan.value = null;
				installationPlanIncomplete.value = false;
			},
			true,
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
					agentHostEvents.emit('app-data-cleared', { appId: result.appId });
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

	async function retirePackage(installation: PluginPackageInstallation, clearData: boolean): Promise<void> {
		const original = structuredClone(toRaw(installation));
		await write((signal) => retirePluginPackage(original, clearData, signal));
	}

	async function cancelPackageUpdate(installation: PluginPackageInstallation): Promise<void> {
		if (installation.status !== 'draining') return;
		const original = structuredClone(toRaw(installation));
		await write((signal) => cancelPluginPackageUpdate(original, signal), undefined, true);
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
				agentHostEvents.emit('app-data-cleared', { appId: intent.appId });
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
		packageInstallations,
		retainedPackageIds,
		retirePackage,
		cancelPackageUpdate,
		retainedAppIds,
		versions,
		candidate,
		candidatePlan,
		installationPlanIncomplete,
		candidateCapabilities,
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
