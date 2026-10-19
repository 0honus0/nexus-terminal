import { computed, onActivated, onMounted, ref, toRaw, watch } from 'vue';
import { AGENT_ARTIFACT_MAX_BYTES } from '@nexus-terminal/shared/agent/artifacts/values';
import { listManagedApps } from '../api/app-management-api';
import {
	beginManagedArtifact,
	confirmArtifactCleanup,
	deleteManagedArtifact,
	downloadManagedArtifact,
	getArtifactStorage,
	getManagedArtifact,
	listManagedArtifacts,
	previewArtifactCleanup,
	retainManagedArtifact,
	uploadManagedArtifact,
} from '../api/artifact-management-api';
import type { ManagedApp } from '../model/app-management-types';
import type {
	ArtifactCleanupPlan,
	ArtifactCleanupResult,
	ArtifactFilters,
	ArtifactStorage,
	ManagedArtifact,
} from '../model/artifact-types';
import { AgentManagementFailure } from '../model/management-failure';
import { useAgentManagementOperation } from './use-agent-management-operation';

function newFilters(): ArtifactFilters {
	return { appId: '', kind: '', retention: 'all', query: '' };
}

export function useArtifactLibrary(available: () => boolean) {
	const apps = ref<ManagedApp[]>([]);
	const filters = ref(newFilters());
	const items = ref<ManagedArtifact[]>([]);
	const storage = ref<ArtifactStorage | null>(null);
	const statsRequired = ref(true);
	const needsReload = ref(true);
	const offset = ref(0);
	const nextOffset = ref<number | null>(null);
	const deleteTarget = ref<ManagedArtifact | null>(null);
	const uploadFile = ref<File | null>(null);
	const uploadRecord = ref<ManagedArtifact | null>(null);
	const uploadUnknown = ref(false);
	const uploadAcknowledged = ref(false);
	const cleanupPlan = ref<ArtifactCleanupPlan | null>(null);
	const cleanupResult = ref<ArtifactCleanupResult | null>(null);
	const cleanupUnknown = ref(false);
	let cleanupAppId = '';
	let revision = 0;
	const downloadUrls = new Map<string, ReturnType<typeof setTimeout>>();
	const operation = useAgentManagementOperation(() => {
		revision += 1;
		filters.value = newFilters();
		items.value = [];
		needsReload.value = true;
		offset.value = 0;
		nextOffset.value = null;
		deleteTarget.value = null;
		uploadFile.value = null;
		uploadRecord.value = null;
		uploadUnknown.value = false;
		uploadAcknowledged.value = false;
		cleanupPlan.value = null;
		cleanupResult.value = null;
		cleanupUnknown.value = false;
		cleanupAppId = '';
		for (const [url, timer] of downloadUrls) {
			clearTimeout(timer);
			URL.revokeObjectURL(url);
		}
		downloadUrls.clear();
	}, available);
	const appOperation = useAgentManagementOperation(() => {
		apps.value = [];
	}, available);
	const storageOperation = useAgentManagementOperation(() => {
		storage.value = null;
		statsRequired.value = true;
	}, available);
	const blocked = computed(() => operation.busy.value || operation.refreshRequired.value || needsReload.value);

	function invalidate(): void {
		revision += 1;
		needsReload.value = true;
		statsRequired.value = true;
	}

	async function load(pageOffset = 0): Promise<void> {
		if (operation.busy.value) {
			return;
		}
		needsReload.value = true;
		const current = revision;
		const query = structuredClone(toRaw(filters.value));
		await operation.execute(
			(signal) => listManagedArtifacts(query, pageOffset, signal),
			(page) => {
				if (current !== revision) {
					return;
				}
				items.value = page.items;
				offset.value = pageOffset;
				nextOffset.value = page.nextOffset;
				deleteTarget.value = null;
				needsReload.value = false;
			},
			{ write: false },
		);
	}

	async function loadStorage(): Promise<void> {
		const current = revision;
		await storageOperation.execute(
			getArtifactStorage,
			(value) => {
				if (current === revision) {
					storage.value = value;
					statsRequired.value = false;
				}
			},
			{ write: false },
		);
	}

	async function loadApps(): Promise<void> {
		await appOperation.execute(
			listManagedApps,
			(value) => {
				apps.value = value;
			},
			{ write: false },
		);
	}

	async function retain(item: ManagedArtifact): Promise<void> {
		if (blocked.value) {
			return;
		}
		const original = structuredClone(toRaw(item));
		await operation.execute((signal) => retainManagedArtifact(original, signal), invalidate, { write: true });
	}

	async function remove(): Promise<void> {
		if (blocked.value || deleteTarget.value === null) {
			return;
		}
		const original = structuredClone(toRaw(deleteTarget.value));
		await operation.execute(
			(signal) => deleteManagedArtifact(original, signal),
			() => {
				deleteTarget.value = null;
				invalidate();
			},
			{ write: true },
		);
	}

	async function upload(): Promise<void> {
		if (blocked.value || uploadUnknown.value || !uploadFile.value || !filters.value.appId) {
			return;
		}
		const file = uploadFile.value;
		const appId = filters.value.appId;
		uploadRecord.value = null;
		await operation.execute(
			async (signal) => {
				if (file.size > AGENT_ARTIFACT_MAX_BYTES) {
					throw new AgentManagementFailure('invalid_input', 'not_dispatched');
				}
				const reservation = await beginManagedArtifact(appId, file, signal);
				if (!signal.aborted) {
					uploadRecord.value = reservation;
				}
				return uploadManagedArtifact(reservation, file, signal);
			},
			(value) => {
				uploadRecord.value = value;
				uploadFile.value = null;
				invalidate();
			},
			{
				write: true,

				onFailure() {
					if (operation.notice.value === 'unknown') {
						uploadUnknown.value = true;
					}
					if (uploadRecord.value !== null || uploadUnknown.value) {
						invalidate();
					}
				},
			},
		);
	}

	async function checkUpload(): Promise<void> {
		if (uploadRecord.value === null) {
			return;
		}
		const original = uploadRecord.value;
		await operation.execute(
			(signal) => getManagedArtifact(original.appId, original.id, signal),
			(value) => {
				uploadRecord.value = value;
				if (value.status === 'ready' || value.status === 'deleted' || value.status === 'unavailable') {
					uploadUnknown.value = false;
					uploadFile.value = null;
				}
				invalidate();
			},
			{ write: false },
		);
	}

	function newUploadIntent(): void {
		if (blocked.value || !uploadAcknowledged.value) {
			return;
		}
		uploadUnknown.value = false;
		uploadAcknowledged.value = false;
		uploadFile.value = null;
		uploadRecord.value = null;
	}

	async function download(item: ManagedArtifact): Promise<void> {
		if (blocked.value) {
			return;
		}
		const original = structuredClone(toRaw(item));
		await operation.execute(
			(signal) => downloadManagedArtifact(original, signal),
			(blob) => {
				const url = URL.createObjectURL(blob);
				const anchor = document.createElement('a');
				try {
					anchor.href = url;
					anchor.download = original.name;
					anchor.rel = 'noopener';
					document.body.append(anchor);
					anchor.click();
				} finally {
					anchor.remove();
					downloadUrls.set(
						url,
						setTimeout(() => {
							URL.revokeObjectURL(url);
							downloadUrls.delete(url);
						}, 0),
					);
				}
			},
			{ write: false },
		);
	}

	async function prepareCleanup(): Promise<void> {
		if (blocked.value || cleanupUnknown.value || cleanupPlan.value !== null || !filters.value.appId) {
			return;
		}
		const appId = filters.value.appId;
		await operation.execute(
			(signal) => previewArtifactCleanup(appId, signal),
			(value) => {
				cleanupPlan.value = value;
				cleanupAppId = appId;
				cleanupResult.value = null;
			},
			{ write: true },
		);
	}

	async function confirmCleanup(): Promise<void> {
		if (blocked.value || cleanupUnknown.value || cleanupPlan.value === null) {
			return;
		}
		const plan = structuredClone(toRaw(cleanupPlan.value));
		const appId = cleanupAppId;
		await operation.execute(
			(signal) => confirmArtifactCleanup(appId, plan, signal),
			(value) => {
				cleanupResult.value = value;
				cleanupPlan.value = null;
				invalidate();
			},
			{
				write: true,

				onFailure() {
					if (operation.notice.value === 'unknown') {
						cleanupUnknown.value = true;
						invalidate();
					}
				},
			},
		);
	}

	function discardCleanup(): void {
		if (!operation.busy.value && !cleanupUnknown.value) {
			cleanupPlan.value = null;
		}
	}

	function initial(): void {
		if (!available()) {
			return;
		}
		if (needsReload.value) {
			void load();
		}
		if (statsRequired.value) {
			void loadStorage();
		}
		if (appOperation.refreshRequired.value) {
			void loadApps();
		}
	}

	onMounted(initial);
	onActivated(initial);
	watch(available, (active) => {
		if (active) {
			initial();
		}
	});
	return {
		apps,
		filters,
		items,
		storage,
		statsRequired,
		needsReload,
		offset,
		nextOffset,
		deleteTarget,
		uploadFile,
		uploadRecord,
		uploadUnknown,
		uploadAcknowledged,
		cleanupPlan,
		cleanupResult,
		cleanupUnknown,
		operation,
		appOperation,
		storageOperation,
		blocked,
		load,
		loadStorage,
		loadApps,
		retain,
		remove,
		upload,
		checkUpload,
		newUploadIntent,
		download,
		prepareCleanup,
		confirmCleanup,
		discardCleanup,
	};
}
