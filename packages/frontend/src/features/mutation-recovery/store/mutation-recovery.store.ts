import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { mutationApi } from '../api/mutation-api';
import { MutationRequestFailure, type MutationClaim, type EvidenceInput } from '../model/mutation-types';

export const useMutationRecoveryStore = defineStore('mutation-recovery', () => {
	const items = shallowRef<MutationClaim[]>([]);
	const selected = shallowRef<MutationClaim | null>(null);
	const nextCursor = ref<string | null>(null);
	const loaded = ref(false);
	const busy = ref(false);
	const blocked = ref(false);
	const error = shallowRef<unknown>(null);
	let scope = new AbortController();
	let queue: Promise<unknown> = Promise.resolve();
	let failureRevision = 0;
	let selection = 0;
	const refreshIds = new Set<string>();

	function reset(): void {
		scope.abort();
		scope = new AbortController();
		queue = Promise.resolve();
		failureRevision++;
		selection++;
		refreshIds.clear();
		items.value = [];
		selected.value = null;
		nextCursor.value = null;
		loaded.value = false;
		busy.value = false;
		blocked.value = false;
		error.value = null;
	}

	function enqueue<T>(
		permission: AbortSignal,
		work: (owner: AbortSignal, active: AbortSignal) => Promise<T>,
	): Promise<T> {
		const owner = scope.signal;
		const task = queue.then(() => {
			if (owner.aborted || permission.aborted) {
				throw new MutationRequestFailure('cancelled', 'not_dispatched');
			}
			return work(owner, AbortSignal.any([owner, permission]));
		});
		queue = task.catch(() => undefined);
		return task;
	}

	function load(permission: AbortSignal, recover = false, more = false): Promise<void> {
		if (!recover && blocked.value) {
			return Promise.reject(new MutationRequestFailure('refresh_required', 'not_dispatched'));
		}
		const recoveryRevision = failureRevision;
		return enqueue(permission, async (owner, active) => {
			if (!recover && blocked.value) {
				throw new MutationRequestFailure('refresh_required', 'not_dispatched');
			}
			const after = more ? nextCursor.value : null;
			if (more && (!loaded.value || after === null)) {
				return;
			}
			busy.value = true;
			try {
				const page = await mutationApi.list(after, active);
				const original = selected.value;
				const originalSelection = selection;
				const details: MutationClaim[] = [];
				if (recover) {
					const ids = new Set(refreshIds);
					if (original) {
						ids.add(original.id);
					}
					for (const id of ids) {
						details.push(await mutationApi.get(id, active));
					}
				}
				const detail = details.find((item) => item.id === original?.id);
				if (active.aborted) {
					throw new MutationRequestFailure('cancelled', 'not_dispatched');
				}
				if (more && page.items.some((item) => items.value.some((old) => old.id === item.id))) {
					throw new MutationRequestFailure('protocol_failure', 'unknown');
				}
				if (recover && recoveryRevision !== failureRevision) {
					throw new MutationRequestFailure('refresh_required', 'not_dispatched');
				}
				const entries = page.items.map((item) => details.find((detail) => detail.id === item.id) ?? item);
				items.value = more ? [...items.value, ...entries] : entries;
				nextCursor.value = page.nextCursor;
				loaded.value = true;
				if (detail && selection === originalSelection) {
					selected.value = detail;
				}
				if (recover) {
					refreshIds.clear();
					blocked.value = false;
					error.value = null;
				}
			} catch (cause) {
				if (!owner.aborted && !active.aborted) {
					error.value = cause;
					blocked.value = true;
					failureRevision++;
				}
				throw cause;
			} finally {
				if (!owner.aborted) {
					busy.value = false;
				}
			}
		});
	}

	function select(id: string, permission: AbortSignal): Promise<void> {
		const generation = ++selection;
		selected.value = null;
		return enqueue(permission, async (owner, active) => {
			busy.value = true;
			try {
				const value = await mutationApi.get(id, active);
				if (!active.aborted && generation === selection) {
					selected.value = value;
				}
			} catch (cause) {
				if (!active.aborted) {
					error.value = cause;
				}
				throw cause;
			} finally {
				if (!owner.aborted) {
					busy.value = false;
				}
			}
		});
	}

	function mutate(
		original: MutationClaim,
		permission: AbortSignal,
		work: (signal: AbortSignal) => Promise<MutationClaim>,
	): Promise<void> {
		const originalSelection = selection;
		return enqueue(permission, async (owner, active) => {
			if (blocked.value) {
				throw new MutationRequestFailure('refresh_required', 'not_dispatched');
			}
			busy.value = true;
			try {
				const value = await work(active);
				if (!owner.aborted) {
					items.value = items.value.map((item) => (item.id === value.id ? value : item));
					if (selection === originalSelection && selected.value?.id === original.id) {
						selected.value = value;
					}
					error.value = null;
				}
			} catch (cause) {
				if (!owner.aborted) {
					error.value = cause;
					if (
						!(cause instanceof MutationRequestFailure) ||
						cause.outcome === 'unknown' ||
						cause.code === 'version_conflict' ||
						cause.code === 'resource_active'
					) {
						blocked.value = true;
						refreshIds.add(original.id);
						failureRevision++;
					}
				}
				throw cause;
			} finally {
				if (!owner.aborted) {
					busy.value = false;
				}
			}
		});
	}

	function evidence(original: MutationClaim, input: EvidenceInput, permission: AbortSignal): Promise<void> {
		const command: EvidenceInput = {
			expectedRevision: input.expectedRevision,
			outcome: input.outcome,
			producerStopped: input.producerStopped,
			resourcesStopped: input.resourcesStopped,
			observedAt: input.observedAt,
			note: input.note,
		};
		return mutate(original, permission, (signal) => mutationApi.evidence(original, command, signal));
	}

	function release(original: MutationClaim, evidenceId: string, permission: AbortSignal): Promise<void> {
		return mutate(original, permission, (signal) => mutationApi.release(original, evidenceId, signal));
	}

	return { items, selected, nextCursor, loaded, busy, blocked, error, reset, load, select, evidence, release };
});

registerAuthenticatedSessionReset('mutation-recovery', () => useMutationRecoveryStore().reset());
