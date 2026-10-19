import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TargetSshKeyInput, TargetSshKeyChanges } from '@nexus-terminal/shared/targets/ssh-keys/http';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { TargetRequestFailure } from '@/client/targets/target-types';
import { sshKeysApi } from '../api/ssh-keys-api';
import type { SshKeySummary } from '../model/ssh-key-types';

export const useSshKeysStore = defineStore('ssh-keys', () => {
	const items = ref<SshKeySummary[]>([]);
	const loaded = ref(false);
	const busy = ref(false);
	const needsRefresh = ref(true);
	let generation = 0;
	let revision = 0;
	let session = new AbortController();
	let read: AbortController | null = null;
	let loadPromise: Promise<SshKeySummary[]> | null = null;

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

	async function load(force = false): Promise<SshKeySummary[]> {
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
		const request = sshKeysApi.list(AbortSignal.any([session.signal, controller.signal])).then((incoming) => {
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

	function save(item: SshKeySummary): void {
		items.value = items.value
			.filter((existing) => existing.id !== item.id)
			.concat(item)
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	function create(input: TargetSshKeyInput, signal?: AbortSignal): Promise<SshKeySummary> {
		return mutate((scope) => sshKeysApi.create(input, scope), save, signal);
	}

	function update(snapshot: SshKeySummary, input: TargetSshKeyChanges, signal?: AbortSignal): Promise<SshKeySummary> {
		return mutate((scope) => sshKeysApi.update(snapshot, input, scope), save, signal);
	}

	function remove(id: number, signal?: AbortSignal): Promise<void> {
		return mutate(
			(scope) => sshKeysApi.remove(id, scope),
			() => {
				items.value = items.value.filter((item) => item.id !== id);
			},
			signal,
		);
	}

	return { items, loaded, busy, needsRefresh, reset, load, create, update, remove };
});

registerAuthenticatedSessionReset('ssh-keys-cache', () => useSshKeysStore().reset());
