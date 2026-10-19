import type { SuspendedAutoTermination } from '../model/suspended-session-types';
import { computed, ref } from 'vue';
import { defineStore, storeToRefs } from 'pinia';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { suspendedSessionsApi } from '../api/suspended-sessions-api';
import { SuspendedRequestFailure } from '../model/suspended-session-types';
import type {
	SuspendedSession,
	SuspendedSessionsController,
	SuspendedSessionsLoadOptions,
	SuspendedSessionsLoadResult,
} from '../model/suspended-session-types';

import type { SuspendedAutoTerminationViewModel } from '../model/suspended-session-types';

export function suspendedFailureKey(cause: unknown): string {
	if (!(cause instanceof SuspendedRequestFailure)) {
		return 'sshSuspend.errors.request_failed';
	}
	return 'sshSuspend.errors.' + (cause.outcome === 'unknown' ? 'operation_unknown' : cause.code);
}

const BASE_POLL_MS = 1500;
const IDLE_POLL_MS = 10_000;
const MAX_POLL_MS = 60_000;
const HANDOFF_DELAYS = [0, 120, 300, 650, 1200];

export const useSuspendedSessionsStore = defineStore('suspended-sessions', () => {
	const sessions = ref<SuspendedSession[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const blockedIds = ref(new Set<string>());
	let epoch = 0;
	let generation = 0;
	let unknownRevision = 0;
	let loaded = false;
	let readPromise: Promise<SuspendedSessionsLoadResult> | null = null;
	let readController: AbortController | null = null;
	let refreshQueued = false;
	let pollTimer: number | undefined;
	let pollIntervalMs = BASE_POLL_MS;
	const pollOwners = new Set<symbol>();
	const writes = new Map<string, AbortController>();
	const downloads = new Set<AbortController>();
	const handoffs = new Map<string, AbortController>();
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
							error.value = null;
						}
						result = { ok: true };
					} catch (cause) {
						if (currentEpoch === epoch && current === generation && !controller.signal.aborted) {
							if (!blockedIds.value.size) {
								error.value = suspendedFailureKey(cause);
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
		for (const controller of [...writes.values(), ...handoffs.values(), ...downloads]) {
			controller.abort();
		}
		writes.clear();
		handoffs.clear();
		downloads.clear();
		pollOwners.clear();
		window.clearTimeout(pollTimer);
		pollTimer = undefined;
		pollIntervalMs = BASE_POLL_MS;
		loaded = false;
		readPromise = null;
		readController = null;
		refreshQueued = false;
		sessions.value = [];
		loading.value = false;
		error.value = null;
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
		invalidate();
		try {
			const value = await work(signal ? AbortSignal.any([controller.signal, signal]) : controller.signal);
			if (currentEpoch === epoch) {
				invalidate();
				apply(value);
			}
			return value;
		} catch (cause) {
			if (currentEpoch === epoch) {
				if (!(cause instanceof SuspendedRequestFailure) || cause.outcome === 'unknown') {
					unknownRevision += 1;
					blockedIds.value.add(session.id);
				}
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
			error.value = null;
		}
		return result;
	}

	function schedulePoll(): void {
		if (!pollOwners.size || pollTimer !== undefined) {
			return;
		}
		const currentEpoch = epoch;
		pollTimer = window.setTimeout(async () => {
			pollTimer = undefined;
			if (currentEpoch !== epoch || !pollOwners.size) {
				return;
			}
			const result = await load({ silent: true, force: true });
			if (currentEpoch !== epoch || !pollOwners.size) {
				return;
			}
			if (result.status === 429) {
				pollIntervalMs = Math.min(pollIntervalMs * 2, MAX_POLL_MS);
			} else if (!result.ok) {
				pollIntervalMs = Math.min(Math.max(pollIntervalMs, IDLE_POLL_MS), MAX_POLL_MS);
			} else {
				pollIntervalMs = sessions.value.some((session) => session.status === 'active')
					? BASE_POLL_MS
					: IDLE_POLL_MS;
			}
			schedulePoll();
		}, pollIntervalMs);
	}

	function startPolling(): () => void {
		const owner = Symbol();
		pollOwners.add(owner);
		schedulePoll();
		return () => {
			pollOwners.delete(owner);
			if (!pollOwners.size) {
				window.clearTimeout(pollTimer);
				pollTimer = undefined;
				pollIntervalMs = BASE_POLL_MS;
			}
		};
	}

	function refreshSuspendedSessionsAfterHandoff(workspaceId: string): void {
		handoffs.get(workspaceId)?.abort();
		const controller = new AbortController();
		handoffs.set(workspaceId, controller);
		const currentEpoch = epoch;
		void (async () => {
			let previousDelay = 0;
			for (const delay of HANDOFF_DELAYS) {
				await new Promise<void>((resolve, reject) => {
					const abort = () => {
						controller.signal.removeEventListener('abort', abort);
						window.clearTimeout(timer);
						reject(new DOMException('Handoff cancelled', 'AbortError'));
					};

					const timer = window.setTimeout(() => {
						controller.signal.removeEventListener('abort', abort);
						resolve();
					}, delay - previousDelay);
					controller.signal.addEventListener('abort', abort, { once: true });
					if (controller.signal.aborted) {
						abort();
					}
				});
				previousDelay = delay;
				if (currentEpoch !== epoch || controller.signal.aborted) {
					return;
				}
				const result = await load({ silent: true, force: true });
				if (
					result.ok &&
					sessions.value.some(
						(session) => session.status === 'active' && session.originalWorkspaceId === workspaceId,
					)
				) {
					return;
				}
			}
		})()
			.catch((cause: unknown) => {
				if (currentEpoch === epoch && !controller.signal.aborted && !blockedIds.value.size) {
					error.value = suspendedFailureKey(cause);
				}
			})
			.finally(() => {
				if (handoffs.get(workspaceId) === controller) {
					handoffs.delete(workspaceId);
				}
			});
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
		blockedIds,
		load,
		recover,
		rename,
		remove,
		startPolling,
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

export function useSuspendedSessions(): SuspendedSessionsController {
	const store = useSuspendedSessionsStore();
	const { sessions, loading, error } = storeToRefs(store);
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
		filtered,
		load: store.load,
		recover: store.recover,

		startPolling: () => {
			stop ??= store.startPolling();
		},

		stopPolling: () => {
			stop?.();
			stop = undefined;
		},

		rename: store.rename,
		remove: store.remove,
		exportLog: store.exportLog,
	};
}
