import type { SuspendedAutoTermination } from '../model/suspended-session-types';
import { computed, ref, shallowRef } from 'vue';
import { defineStore, storeToRefs } from 'pinia';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { suspendedSessionsApi } from '../api/suspended-sessions-api';
import { subscribeSuspendedCatalog } from '../api/suspended-catalog-stream';
import { SuspendedRequestFailure } from '../model/suspended-session-types';
import type {
	SuspendedSession,
	SuspendedSessionsController,
	SuspendedSessionsLoadOptions,
	SuspendedSessionsLoadResult,
} from '../model/suspended-session-types';

import type { SuspendedAutoTerminationViewModel } from '../model/suspended-session-types';

export function suspendedFailureKey(cause: unknown, operation: 'read' | 'mutation' = 'mutation'): string {
	if (!(cause instanceof SuspendedRequestFailure)) {
		return 'sshSuspend.errors.request_failed';
	}
	if (operation === 'read' && (cause.code === 'operation_unknown' || cause.code === 'internal_failure')) {
		return 'sshSuspend.errors.read_failed';
	}
	return (
		'sshSuspend.errors.' +
		(operation === 'mutation' && cause.outcome === 'unknown' ? 'operation_unknown' : cause.code)
	);
}

export const useSuspendedSessionsStore = defineStore('suspended-sessions', () => {
	const sessions = ref<SuspendedSession[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const errorCause = shallowRef<unknown>();
	const blockedIds = ref(new Set<string>());
	let epoch = 0;
	let generation = 0;
	let unknownRevision = 0;
	let loaded = false;
	let readPromise: Promise<SuspendedSessionsLoadResult> | null = null;
	let readController: AbortController | null = null;
	let refreshQueued = false;
	let stopStream: (() => void) | undefined;
	let streamRevision = 0;
	const syncOwners = new Set<symbol>();
	const writes = new Map<string, AbortController>();
	const downloads = new Set<AbortController>();
	const handledAutoTerminations = new Set<string>();

	function invalidate(): void {
		generation += 1;
		readController?.abort();
	}

	function applySuspendedAutoTermination(event: SuspendedAutoTermination): SuspendedAutoTerminationViewModel | null {
		if (handledAutoTerminations.has(event.suspendedSessionId)) {
			return null;
		}
		handledAutoTerminations.add(event.suspendedSessionId);
		if (handledAutoTerminations.size > 128) {
			const first = handledAutoTerminations.values().next();
			if (!first.done) {
				handledAutoTerminations.delete(first.value);
			}
		}
		const session = sessions.value.find((item) => item.id === event.suspendedSessionId);
		return {
			suspendedSessionId: event.suspendedSessionId,
			reason: event.reason,
			name: session?.customName ?? session?.connectionName,
		};
	}

	function load(options: SuspendedSessionsLoadOptions = {}): Promise<SuspendedSessionsLoadResult> {
		if (readPromise) {
			if (options.force) {
				invalidate();
				refreshQueued = true;
			}
			return readPromise;
		}
		if (loaded && !options.force && !options.silent) {
			return Promise.resolve({ ok: true });
		}
		const currentEpoch = epoch;
		loading.value = !loaded && !options.silent;
		const pending = Promise.resolve()
			.then(async () => {
				let result: SuspendedSessionsLoadResult = { ok: false };
				do {
					result = { ok: false };
					refreshQueued = false;
					if (currentEpoch !== epoch) {
						return { ok: false };
					}
					const current = generation;
					const controller = new AbortController();
					readController = controller;
					try {
						const incoming = await suspendedSessionsApi.list(controller.signal);
						if (currentEpoch !== epoch || current !== generation) {
							continue;
						}
						sessions.value = incoming;
						loaded = true;
						if (!blockedIds.value.size) {
							errorCause.value = undefined;
							error.value = null;
						}
						result = { ok: true };
					} catch (cause) {
						if (currentEpoch === epoch && current === generation && !controller.signal.aborted) {
							if (!blockedIds.value.size) {
								errorCause.value = cause;
								error.value = suspendedFailureKey(cause, 'read');
							}
							result = {
								ok: false,
								status: cause instanceof SuspendedRequestFailure ? cause.status : undefined,
							};
						}
					}
				} while (currentEpoch === epoch && refreshQueued);
				return result;
			})
			.finally(() => {
				if (currentEpoch === epoch && readPromise === pending) {
					readPromise = null;
					readController = null;
					loading.value = false;
				}
			});
		readPromise = pending;
		return pending;
	}

	function resetSuspendedSessionsCatalog(): void {
		epoch += 1;
		invalidate();
		for (const controller of [...writes.values(), ...downloads]) {
			controller.abort();
		}
		writes.clear();
		downloads.clear();
		syncOwners.clear();
		stopStream?.();
		stopStream = undefined;
		loaded = false;
		readPromise = null;
		readController = null;
		refreshQueued = false;
		sessions.value = [];
		loading.value = false;
		error.value = null;
		errorCause.value = undefined;
		blockedIds.value = new Set();
		handledAutoTerminations.clear();
	}

	async function mutation<T>(
		session: SuspendedSession,
		work: (signal: AbortSignal) => Promise<T>,
		apply: (value: T) => void,
		signal?: AbortSignal,
	): Promise<T> {
		if (signal?.aborted) {
			throw new SuspendedRequestFailure('cancelled', 'not_dispatched');
		}
		if (writes.has(session.id) || blockedIds.value.has(session.id)) {
			throw new SuspendedRequestFailure('conflict', 'not_dispatched');
		}
		const currentEpoch = epoch;
		const controller = new AbortController();
		writes.set(session.id, controller);
		const revision = streamRevision;
		invalidate();
		try {
			const value = await work(signal ? AbortSignal.any([controller.signal, signal]) : controller.signal);
			if (currentEpoch === epoch) {
				invalidate();
				if (revision === streamRevision) {
					apply(value);
				}
			}
			return value;
		} catch (cause) {
			if (currentEpoch === epoch) {
				if (!(cause instanceof SuspendedRequestFailure) || cause.outcome === 'unknown') {
					unknownRevision += 1;
					blockedIds.value.add(session.id);
				}
				errorCause.value = undefined;
				error.value = blockedIds.value.size
					? 'sshSuspend.errors.operation_unknown'
					: suspendedFailureKey(cause);
			}
			throw cause;
		} finally {
			if (currentEpoch === epoch && writes.get(session.id) === controller) {
				writes.delete(session.id);
			}
		}
	}

	function removeSuspendedSessionFromCatalog(id: string): void {
		invalidate();
		sessions.value = sessions.value.filter((session) => session.id !== id);
	}

	function rename(session: SuspendedSession, name: string, signal?: AbortSignal): Promise<string> {
		return mutation(
			session,
			(active) => suspendedSessionsApi.rename(session.id, name, active),
			(value) => {
				const current = sessions.value.find((item) => item.id === session.id);
				if (current) {
					current.customName = value || undefined;
				}
			},
			signal,
		);
	}

	function remove(session: SuspendedSession, signal?: AbortSignal): Promise<void> {
		const active = session.status === 'active';
		return mutation(
			session,
			(token) =>
				active
					? suspendedSessionsApi.terminate(session.id, token)
					: suspendedSessionsApi.removeDisconnected(session.id, token),
			() => removeSuspendedSessionFromCatalog(session.id),
			signal,
		);
	}

	/** Explicit user read-back; polling never grants permission to repeat an unknown intent. */
	async function recover(): Promise<SuspendedSessionsLoadResult> {
		const currentEpoch = epoch;
		const revision = unknownRevision;
		const result = await load({ force: true });
		if (result.ok && currentEpoch === epoch && revision === unknownRevision && writes.size === 0) {
			blockedIds.value.clear();
			errorCause.value = undefined;
			error.value = null;
		}
		return result;
	}

	function startSync(): () => void {
		const owner = Symbol();
		syncOwners.add(owner);
		if (!stopStream) {
			const currentEpoch = epoch;
			loading.value = !loaded;
			stopStream = subscribeSuspendedCatalog(
				(incoming) => {
					if (currentEpoch !== epoch || !syncOwners.size) {
						return;
					}
					streamRevision += 1;
					invalidate();
					sessions.value = incoming;
					loaded = true;
					loading.value = false;
					if (!blockedIds.value.size) {
						error.value = null;
						errorCause.value = undefined;
					}
				},
				(cause) => {
					if (currentEpoch === epoch && syncOwners.size && !blockedIds.value.size) {
						loading.value = false;
						errorCause.value = cause;
						error.value = suspendedFailureKey(cause, 'read');
					}
				},
			);
		}
		return () => {
			syncOwners.delete(owner);
			if (!syncOwners.size) {
				stopStream?.();
				stopStream = undefined;
				loading.value = false;
			}
		};
	}

	function refreshSuspendedSessionsAfterHandoff(workspaceId: string): void {
		if (
			!stopStream &&
			!sessions.value.some(
				(session) => session.originalWorkspaceId === workspaceId && session.status === 'active',
			)
		) {
			void load({ silent: true, force: true });
		}
	}

	async function exportLog(id: string, signal?: AbortSignal): Promise<string> {
		if (signal?.aborted) {
			throw new SuspendedRequestFailure('cancelled', 'not_dispatched');
		}
		const controller = new AbortController();
		downloads.add(controller);
		try {
			return await suspendedSessionsApi.exportLog(
				id,
				signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
			);
		} finally {
			downloads.delete(controller);
		}
	}

	return {
		exportLog,
		sessions,
		loading,
		error,
		errorCause,
		blockedIds,
		load,
		recover,
		rename,
		remove,
		startSync,
		applySuspendedAutoTermination,
		resetSuspendedSessionsCatalog,
		removeSuspendedSessionFromCatalog,
		refreshSuspendedSessionsAfterHandoff,
	};
});

export const applySuspendedAutoTermination = (
	event: SuspendedAutoTermination,
): SuspendedAutoTerminationViewModel | null => useSuspendedSessionsStore().applySuspendedAutoTermination(event);

export const resetSuspendedSessionsCatalog = (): void => useSuspendedSessionsStore().resetSuspendedSessionsCatalog();

export const startSuspendedSessionsSync = (): (() => void) => useSuspendedSessionsStore().startSync();

registerAuthenticatedSessionReset('suspended-sessions-cache', resetSuspendedSessionsCatalog);

export const refreshSuspendedSessionsCatalog = (): Promise<SuspendedSessionsLoadResult> =>
	useSuspendedSessionsStore().load({ silent: true, force: true });

export const removeSuspendedSessionFromCatalog = (id: string): void =>
	useSuspendedSessionsStore().removeSuspendedSessionFromCatalog(id);

export const refreshSuspendedSessionsAfterHandoff = (workspaceId: string): void =>
	useSuspendedSessionsStore().refreshSuspendedSessionsAfterHandoff(workspaceId);

export const findSuspendedSessionByOriginalWorkspace = (workspaceId: string): SuspendedSession | undefined =>
	useSuspendedSessionsStore().sessions.find(
		(session) => session.status === 'active' && session.originalWorkspaceId === workspaceId,
	);

export const findSuspendedSessionById = (suspendedSessionId: string): SuspendedSession | undefined =>
	useSuspendedSessionsStore().sessions.find(
		(session) => session.status === 'active' && session.id === suspendedSessionId,
	);

export function useSuspendedSessions(): SuspendedSessionsController {
	const store = useSuspendedSessionsStore();
	const { sessions, loading, error, errorCause } = storeToRefs(store);
	const search = ref('');
	const filtered = computed(() => {
		const term = search.value.trim().toLowerCase();
		if (!term) {
			return sessions.value;
		}
		return sessions.value.filter((session) =>
			((session.customName ?? '') + ' ' + session.connectionName).toLowerCase().includes(term),
		);
	});
	let stop: (() => void) | undefined;
	return {
		sessions,
		search,
		loading,
		error,
		errorCause,
		filtered,
		load: store.load,
		recover: store.recover,

		startSync: () => {
			stop ??= store.startSync();
		},

		stopSync: () => {
			stop?.();
			stop = undefined;
		},

		rename: store.rename,
		remove: store.remove,
		exportLog: store.exportLog,
	};
}
