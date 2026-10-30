import type {
	TargetImportInput,
	TargetImportItem,
	TargetCredentialInput,
} from '@nexus-terminal/shared/targets/connections/http';
import { computed } from 'vue';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TargetConnectionChanges } from '@nexus-terminal/shared/targets/connections/http';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { TargetRequestFailure } from '@/client/targets/target-types';
import { connectionsApi } from '../api/connections-api';
import type { ConnectionSummary } from '../model/connection-types';

export const useConnectionsStore = defineStore('connections', () => {
	const items = ref<ConnectionSummary[]>([]);
	const loaded = ref(false);
	const loadedAt = ref(0);
	const connections = computed(() => items.value);
	const busy = ref(false);
	const needsRefresh = ref(true);
	let generation = 0;
	let revision = 0;
	let session = new AbortController();
	let read: AbortController | null = null;
	let loadPromise: Promise<ConnectionSummary[]> | null = null;
	const refreshes = new Map<number, AbortController>();

	function cancelListRead(): void {
		read?.abort();
		read = null;
		loadPromise = null;
	}

	function reset(): void {
		generation += 1;
		revision += 1;
		session.abort();
		read?.abort();
		session = new AbortController();
		read = null;
		loadPromise = null;
		items.value = [];
		loaded.value = false;
		loadedAt.value = 0;
		refreshes.clear();
		busy.value = false;
		needsRefresh.value = true;
	}

	async function load(force = false): Promise<ConnectionSummary[]> {
		if (busy.value) {
			throw new TargetRequestFailure('request_pending', 'not_dispatched');
		}
		if (loadPromise) {
			return loadPromise;
		}
		if (loaded.value && !needsRefresh.value && !force) {
			return items.value;
		}
		const current = generation;
		const snapshot = revision;
		const controller = new AbortController();
		read = controller;
		const request = connectionsApi.list(AbortSignal.any([session.signal, controller.signal])).then((incoming) => {
			if (current !== generation || snapshot !== revision || controller.signal.aborted) {
				throw new TargetRequestFailure('cancelled', 'confirmed');
			}
			revision += 1;
			items.value = incoming.sort((a, b) => a.name.localeCompare(b.name));
			loaded.value = true;
			loadedAt.value = Date.now();
			needsRefresh.value = false;
			return items.value;
		});
		loadPromise = request;
		try {
			return await request;
		} catch (cause) {
			if (current === generation && snapshot === revision && !controller.signal.aborted) {
				needsRefresh.value = true;
			}
			throw cause;
		} finally {
			if (loadPromise === request) {
				loadPromise = null;
				read = null;
			}
		}
	}

	async function mutate<T>(
		work: (signal: AbortSignal) => Promise<T>,
		publish: (result: T) => void,
		signal?: AbortSignal,
	): Promise<T> {
		if (busy.value || needsRefresh.value) {
			throw new TargetRequestFailure(busy.value ? 'request_pending' : 'recovery_required', 'not_dispatched');
		}
		const current = generation;
		revision += 1;
		read?.abort();
		read = null;
		loadPromise = null;
		busy.value = true;
		const scope = signal ? AbortSignal.any([session.signal, signal]) : session.signal;
		try {
			const result = await work(scope);
			if (current !== generation || scope.aborted) {
				throw new TargetRequestFailure('cancelled', 'unknown');
			}
			publish(result);
			return result;
		} catch (cause) {
			if (
				current === generation &&
				(!(cause instanceof TargetRequestFailure) ||
					cause.outcome === 'unknown' ||
					['version_conflict', 'not_found', 'unauthenticated', 'forbidden'].includes(cause.code))
			) {
				needsRefresh.value = true;
			}
			throw cause;
		} finally {
			if (current === generation) {
				busy.value = false;
			}
		}
	}

	function save(item: ConnectionSummary): void {
		items.value = items.value
			.filter((existing) => existing.id !== item.id)
			.concat(item)
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	function invalidate(): void {
		needsRefresh.value = true;
		loaded.value = false;
	}

	function importMany(inputs: TargetImportInput[], signal?: AbortSignal): Promise<TargetImportItem[]> {
		return mutate((scope) => connectionsApi.importMany(inputs, scope), invalidate, signal);
	}

	function create(input: TargetImportInput, signal?: AbortSignal): Promise<TargetImportItem[]> {
		return importMany([input], signal);
	}

	async function revalidate(maxAgeMs = 30_000): Promise<ConnectionSummary[]> {
		return load(needsRefresh.value || Date.now() - loadedAt.value >= Math.max(0, maxAgeMs));
	}

	async function refresh(id: number): Promise<ConnectionSummary> {
		if (busy.value) {
			throw new TargetRequestFailure('request_pending', 'not_dispatched');
		}
		const current = generation;
		const snapshot = revision;
		cancelListRead();
		refreshes.get(id)?.abort();
		const controller = new AbortController();
		refreshes.set(id, controller);
		const scope = AbortSignal.any([session.signal, controller.signal]);
		try {
			const item = await connectionsApi.get(id, scope);
			if (current !== generation || snapshot !== revision || scope.aborted) {
				throw new TargetRequestFailure('cancelled', 'confirmed');
			}
			cancelListRead();
			save(item);
			return item;
		} catch (cause) {
			if (current === generation && snapshot === revision && refreshes.get(id) === controller) {
				needsRefresh.value = true;
			}
			throw cause;
		} finally {
			if (refreshes.get(id) === controller) {
				refreshes.delete(id);
			}
		}
	}

	function clone(id: number, name: string, signal?: AbortSignal): Promise<ConnectionSummary> {
		return mutate((scope) => connectionsApi.clone(id, name, scope), save, signal);
	}

	function setCredential(
		snapshot: ConnectionSummary,
		credential: TargetCredentialInput | null,
		signal?: AbortSignal,
	): Promise<void> {
		return mutate((scope) => connectionsApi.setCredential(snapshot, credential, scope), invalidate, signal);
	}

	function addTag(ids: number[], tagId: number, signal?: AbortSignal): Promise<void> {
		return mutate((scope) => connectionsApi.addTag(ids, tagId, scope), invalidate, signal);
	}

	function update(
		snapshot: ConnectionSummary,
		input: TargetConnectionChanges,
		signal?: AbortSignal,
		credential?: TargetCredentialInput | null,
	): Promise<ConnectionSummary> {
		return mutate((scope) => connectionsApi.update(snapshot, input, scope, credential), save, signal);
	}

	function remove(id: number, signal?: AbortSignal): Promise<void> {
		return mutate(
			(scope) => connectionsApi.remove(id, scope),
			() => {
				items.value = items.value.filter((item) => item.id !== id);
			},
			signal,
		);
	}

	return {
		items,
		connections,
		loaded,
		loadedAt,
		busy,
		needsRefresh,
		reset,
		load,
		revalidate,
		refresh,
		create,
		importMany,
		update,
		remove,
		clone,
		setCredential,
		addTag,
	};
});

registerAuthenticatedSessionReset('connections-cache', () => useConnectionsStore().reset());
