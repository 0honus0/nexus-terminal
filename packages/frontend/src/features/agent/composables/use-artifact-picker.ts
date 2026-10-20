import { computed, ref, watch } from 'vue';
import {
	beginManagedArtifact,
	getManagedArtifact,
	listManagedArtifacts,
	uploadManagedArtifact,
} from '../api/artifact-management-api';
import type { ManagedArtifact } from '../model/artifact-types';
import { useAgentManagementOperation } from './use-agent-management-operation';

/** The picker serializes uploads and stops at the first failure; it never replays a write. */
export function useArtifactPicker(
	available: () => boolean,
	appId: () => string,
	accept: (item: ManagedArtifact) => void,
) {
	const query = ref('');
	const items = ref<ManagedArtifact[]>([]);
	const nextOffset = ref<number | null>(null);
	const needsReload = ref(true);
	const uploadUnknown = ref(false);
	const reservation = ref<ManagedArtifact | null>(null);
	const acknowledged = ref(false);
	const operation = useAgentManagementOperation(() => {
		query.value = '';
		items.value = [];
		nextOffset.value = null;
		needsReload.value = true;
		uploadUnknown.value = false;
		reservation.value = null;
		acknowledged.value = false;
	}, available);
	const blocked = computed(() => operation.busy.value || operation.refreshRequired.value || needsReload.value);

	watch(query, () => {
		needsReload.value = true;
	});

	async function load(more = false): Promise<void> {
		if (operation.busy.value || (more && (needsReload.value || nextOffset.value === null))) {
			return;
		}
		const offset = more ? nextOffset.value : 0;
		if (offset === null) {
			return;
		}
		const text = query.value.trim();
		needsReload.value = true;
		await operation.execute(
			(signal) => listManagedArtifacts({ appId: '', query: text, kind: '', retention: 'all' }, offset, signal),
			(page) => {
				if (text !== query.value.trim()) {
					return;
				}
				const ready = page.items.filter((item) => item.status === 'ready');
				const known = new Set(more ? items.value.map((item) => item.id) : []);
				items.value = more ? [...items.value, ...ready.filter((item) => !known.has(item.id))] : ready;
				nextOffset.value = page.nextOffset;
				needsReload.value = false;
			},
			{ write: false },
		);
	}

	async function uploadFiles(files: readonly File[]): Promise<void> {
		if (blocked.value || uploadUnknown.value || !files.length) {
			return;
		}
		const owner = appId();
		reservation.value = null;
		await operation.execute(
			async (signal) => {
				for (const file of files) {
					if (signal.aborted || owner !== appId() || !available()) return;
					reservation.value = null;
					const value = await beginManagedArtifact(owner, file, signal);
					if (signal.aborted || owner !== appId() || !available()) return;
					reservation.value = value;
					const item = await uploadManagedArtifact(value, file, signal);
					if (signal.aborted || owner !== appId() || !available()) return;
					reservation.value = item;
					needsReload.value = true;
					accept(item);
				}
			},
			() => {
				needsReload.value = true;
			},
			{
				write: true,

				onFailure() {
					uploadUnknown.value = operation.notice.value === 'unknown';
					if (uploadUnknown.value || reservation.value !== null) {
						needsReload.value = true;
					}
				},
			},
		);
	}

	async function checkUpload(): Promise<void> {
		const original = reservation.value;
		if (!original || operation.busy.value) {
			return;
		}
		await operation.execute(
			(signal) => getManagedArtifact(original.appId, original.id, signal),
			(item) => {
				reservation.value = item;
				if (item.status === 'ready') {
					uploadUnknown.value = false;
					accept(item);
				}
				if (item.status === 'deleted' || item.status === 'unavailable') {
					uploadUnknown.value = false;
				}
				needsReload.value = true;
			},
			{ write: false },
		);
	}

	function newIntent(): void {
		if (blocked.value || !acknowledged.value) {
			return;
		}
		uploadUnknown.value = false;
		reservation.value = null;
		acknowledged.value = false;
	}

	watch(available, (active) => {
		if (active) {
			void load();
		}
	});
	return {
		query,
		items,
		nextOffset,
		needsReload,
		uploadUnknown,
		reservation,
		acknowledged,
		operation,
		blocked,
		load,
		uploadFiles,
		checkUpload,
		newIntent,
	};
}
