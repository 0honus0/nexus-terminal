import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TargetProxyInput } from '@nexus-terminal/shared/targets/proxies/http';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { TargetRequestFailure } from '@/client/targets/target-types';
import { proxiesApi } from '../api/proxies-api';
import type { ProxySummary } from '../model/proxy-types';

export const useProxiesStore = defineStore('proxies', () => {
	const items = ref<ProxySummary[]>([]);
	const loaded = ref(false);
	const busy = ref(false);
	const needsRefresh = ref(true);
	let generation = 0;
	let revision = 0;
	let session = new AbortController();
	let read: AbortController | null = null;
	let loadPromise: Promise<ProxySummary[]> | null = null;

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
		busy.value = false;
		needsRefresh.value = true;
	}

	async function load(force = false): Promise<ProxySummary[]> {
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
		const request = proxiesApi.list(AbortSignal.any([session.signal, controller.signal])).then((incoming) => {
			if (current !== generation || snapshot !== revision || controller.signal.aborted) {
				throw new TargetRequestFailure('cancelled', 'confirmed');
			}
			items.value = incoming.sort((a, b) => a.name.localeCompare(b.name));
			loaded.value = true;
			needsRefresh.value = false;
			return items.value;
		});
		loadPromise = request;
		try {
			return await request;
		} catch (cause) {
			if (current === generation && snapshot === revision) {
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

	function save(item: ProxySummary): void {
		items.value = items.value
			.filter((existing) => existing.id !== item.id)
			.concat(item)
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	function create(input: TargetProxyInput, signal?: AbortSignal): Promise<ProxySummary> {
		return mutate((scope) => proxiesApi.create(input, scope), save, signal);
	}

	function update(snapshot: ProxySummary, input: TargetProxyInput, signal?: AbortSignal): Promise<ProxySummary> {
		return mutate((scope) => proxiesApi.update(snapshot, input, scope), save, signal);
	}

	function remove(id: number, signal?: AbortSignal): Promise<void> {
		return mutate(
			(scope) => proxiesApi.remove(id, scope),
			() => {
				items.value = items.value.filter((item) => item.id !== id);
			},
			signal,
		);
	}

	return { items, loaded, busy, needsRefresh, reset, load, create, update, remove };
});

registerAuthenticatedSessionReset('proxies-cache', () => useProxiesStore().reset());
