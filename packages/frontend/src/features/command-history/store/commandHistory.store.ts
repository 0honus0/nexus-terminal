import { computed, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { PreferenceRequestFailure } from '@/client/preferences/preference-request';
import { commandHistoryApi } from '../api/command-history-api';
import type { CommandHistoryItem } from '../model/command-history-types';

export const useCommandHistoryStore = defineStore('command-history', () => {
	const items = ref<CommandHistoryItem[]>([]),
		search = ref(''),
		loading = ref(false),
		error = shallowRef<unknown>(null),
		selectedIndex = ref(-1);
	let queue: Promise<unknown> = Promise.resolve();
	let scope = new AbortController();
	let blocked = false;
	let recoveryRevision = 0;

	function reset(): void {
		scope.abort();
		scope = new AbortController();
		blocked = false;
		recoveryRevision += 1;
		items.value = [];
		search.value = '';
		loading.value = false;
		error.value = null;
		selectedIndex.value = -1;
		queue = Promise.resolve();
	}

	const filtered = computed(() => {
		const term = search.value.trim().toLowerCase();
		return items.value.filter((x) => !term || x.command.toLowerCase().includes(term));
	});
	const selected = computed(() => filtered.value[selectedIndex.value] ?? null);

	watch(search, () => {
		selectedIndex.value = -1;
	});

	function enqueue<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const signal = scope.signal;
		const task = queue.then(() => {
			if (signal.aborted) {
				throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
			}
			return operation(signal);
		});
		queue = task.catch(() => undefined);
		return task;
	}

	function load(recover = false): Promise<void> {
		const revision = recoveryRevision;
		return enqueue(async (signal) => {
			loading.value = true;
			if (!blocked) {
				error.value = null;
			}
			try {
				const next = await commandHistoryApi.list(signal);
				if (signal.aborted) {
					return;
				}
				items.value = next.sort((a, b) => b.timestamp - a.timestamp);
				if (recover && revision === recoveryRevision) {
					blocked = false;
					error.value = null;
				}
			} catch (cause) {
				if (!signal.aborted) {
					error.value = cause;
				}
				throw cause;
			} finally {
				if (!signal.aborted) {
					loading.value = false;
				}
			}
		});
	}

	function mutate(operation: (signal: AbortSignal) => Promise<void>, permission?: AbortSignal): Promise<void> {
		return enqueue(async (signal) => {
			if (permission?.aborted) {
				throw new PreferenceRequestFailure('cancelled', 'not_dispatched');
			}
			if (blocked) {
				throw new PreferenceRequestFailure('refresh_required', 'not_dispatched');
			}
			try {
				await operation(signal);
			} catch (cause) {
				if (!signal.aborted) {
					error.value = cause;
					if (cause instanceof PreferenceRequestFailure && cause.outcome === 'unknown') {
						blocked = true;
						recoveryRevision += 1;
					}
				}
				throw cause;
			}
		});
	}

	async function add(command: string, permission?: AbortSignal): Promise<void> {
		const original = scope.signal;
		const value = command.trim();
		if (!value || value === '\x03') {
			return;
		}
		await mutate(async (signal) => {
			await commandHistoryApi.add(value, signal);
		}, permission);
		if (original.aborted) {
			return;
		}
		// Appending and refreshing are separate outcomes. A failed read remains visible without replaying the append.
		await load().catch(() => undefined);
	}

	function remove(id: number, permission?: AbortSignal): Promise<void> {
		return mutate(async (signal) => {
			await commandHistoryApi.remove(id, signal);
			if (!signal.aborted) {
				items.value = items.value.filter((value) => value.id !== id);
				selectedIndex.value = -1;
			}
		}, permission);
	}

	function clear(permission?: AbortSignal): Promise<void> {
		return mutate(async (signal) => {
			await commandHistoryApi.clear(signal);
			if (!signal.aborted) {
				items.value = [];
				selectedIndex.value = -1;
			}
		}, permission);
	}

	function setSearch(value: string): void {
		search.value = value;
	}

	function selectNext(): void {
		if (!filtered.value.length) {
			selectedIndex.value = -1;
			return;
		}
		selectedIndex.value = (selectedIndex.value + 1) % filtered.value.length;
	}

	function selectPrevious(): void {
		if (!filtered.value.length) {
			selectedIndex.value = -1;
			return;
		}
		selectedIndex.value = (selectedIndex.value - 1 + filtered.value.length) % filtered.value.length;
	}

	function resetSelection(): void {
		selectedIndex.value = -1;
	}

	return {
		reset,
		items,
		search,
		loading,
		error,
		filtered,
		selectedIndex,
		selected,
		load,
		add,
		remove,
		clear,
		setSearch,
		selectNext,
		selectPrevious,
		resetSelection,
	};
});

registerAuthenticatedSessionReset('command-history-cache', () => useCommandHistoryStore().reset());
