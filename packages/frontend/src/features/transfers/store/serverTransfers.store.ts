import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { serverTransfersApi } from '../api/server-transfers-api';
import { toTransferTask } from '../model/server-transfer-mapper';
import { ServerTransferRequestFailure } from '../model/server-transfer-types';
import type { SendFilesCommand, ServerTransferTask } from '../model/server-transfer-types';

export function serverTransferFailureKey(cause: unknown): string {
	if (!(cause instanceof ServerTransferRequestFailure)) {
		return 'serverTransferErrors.internal_failure';
	}
	return cause.outcome === 'unknown'
		? 'serverTransferErrors.operation_unknown'
		: 'serverTransferErrors.' + cause.code;
}

export const useServerTransfersStore = defineStore('serverTransfers', () => {
	const items = ref<ServerTransferTask[]>([]);
	const loading = ref(false);
	const error = ref('');
	const sendBlocked = ref(false);
	const progressTasks = computed(() => items.value.map(toTransferTask).sort((a, b) => b.createdAt - a.createdAt));
	const hasActiveTasks = computed(() =>
		items.value.some((task) => ['queued', 'in-progress', 'cancelling'].includes(task.status)),
	);
	let epoch = 0;
	let generation = 0;
	let timer: number | undefined;
	let pollingEnabled = false;
	let pollingIntervalMs = 2000;
	let readController: AbortController | null = null;
	let readPromise: Promise<void> | null = null;
	let refreshQueued = false;
	let refreshOnResume = false;
	let readFailed = false;
	const writes = new Set<AbortController>();
	const mutations = new Map<string, Promise<void>>();

	function clearPollingTimer(): void {
		window.clearTimeout(timer);
		timer = undefined;
	}

	function stopPolling(): void {
		pollingEnabled = false;
		refreshOnResume = false;
		clearPollingTimer();
		document.removeEventListener('visibilitychange', syncPollingVisibility);
		window.removeEventListener('pageshow', syncPollingVisibility);
		window.removeEventListener('online', syncPollingVisibility);
		window.removeEventListener('offline', syncPollingVisibility);
	}

	function syncPollingVisibility(): void {
		clearPollingTimer();
		if (!pollingEnabled) return;
		if (document.hidden || !navigator.onLine) {
			// Only the status read is cancelled; server tasks and mutation owners continue.
			refreshOnResume ||= readPromise !== null || hasActiveTasks.value || readFailed;
			invalidate();
			refreshQueued = false;
			return;
		}
		if (!refreshOnResume && !hasActiveTasks.value && !readFailed) return;
		refreshOnResume = false;
		void load({ background: true, ensureFresh: true });
	}

	function schedulePolling(): void {
		clearPollingTimer();
		if (!pollingEnabled || document.hidden || !navigator.onLine || readPromise || !hasActiveTasks.value) {
			return;
		}
		timer = window.setTimeout(() => {
			timer = undefined;
			if (pollingEnabled && !document.hidden && navigator.onLine) {
				void load({ background: true });
			}
		}, pollingIntervalMs);
	}

	function reset(): void {
		epoch += 1;
		generation += 1;
		stopPolling();
		readController?.abort();
		for (const controller of writes) {
			controller.abort();
		}
		writes.clear();
		mutations.clear();
		readPromise = null;
		readController = null;
		refreshQueued = false;
		readFailed = false;
		items.value = [];
		loading.value = false;
		error.value = '';
		sendBlocked.value = false;
	}

	function invalidate(): void {
		generation += 1;
		readController?.abort();
	}

	function load(options: { background?: boolean; ensureFresh?: boolean } = {}): Promise<void> {
		if (document.hidden) {
			refreshOnResume = true;
			return Promise.resolve();
		}
		if (readPromise) {
			if (options.ensureFresh) {
				invalidate();
				refreshQueued = true;
			}
			return readPromise;
		}
		clearPollingTimer();
		const currentEpoch = epoch;
		if (!options.background) {
			loading.value = true;
		}
		const pending = Promise.resolve()
			.then(async () => {
				if (currentEpoch !== epoch || document.hidden) {
					return;
				}
				do {
					refreshQueued = false;
					if (document.hidden) return;
					const current = generation;
					const active = new AbortController();
					readController = active;
					try {
						const next = await serverTransfersApi.list(active.signal);
						if (currentEpoch === epoch && current === generation) {
							readFailed = false;
							items.value = next;
							if (!sendBlocked.value) {
								error.value = '';
							}
						}
					} catch (cause) {
						if (currentEpoch === epoch && current === generation && !active.signal.aborted) {
							readFailed = true;
							error.value = serverTransferFailureKey(cause);
						}
					}
				} while (currentEpoch === epoch && refreshQueued);
			})
			.finally(() => {
				if (currentEpoch === epoch && readPromise === pending) {
					readPromise = null;
					readController = null;
					loading.value = false;
					schedulePolling();
				}
			});
		readPromise = pending;
		return pending;
	}

	async function send(command: SendFilesCommand, signal?: AbortSignal): Promise<ServerTransferTask> {
		if (sendBlocked.value) {
			throw new ServerTransferRequestFailure('operation_unknown', 'unknown');
		}
		const currentEpoch = epoch;
		const controller = new AbortController();
		writes.add(controller);
		invalidate();
		try {
			const task = await serverTransfersApi.send(
				command,
				signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
			);
			if (currentEpoch === epoch) {
				invalidate();
				items.value = [task, ...items.value.filter((item) => item.taskId !== task.taskId)];
			}
			return task;
		} catch (cause) {
			if (currentEpoch === epoch) {
				sendBlocked.value ||= !(cause instanceof ServerTransferRequestFailure) || cause.outcome === 'unknown';
				error.value = sendBlocked.value
					? 'serverTransferErrors.operation_unknown'
					: serverTransferFailureKey(cause);
				if (sendBlocked.value) {
					void load({ background: true, ensureFresh: true });
				}
			}
			throw cause;
		} finally {
			writes.delete(controller);
			if (currentEpoch === epoch) {
				schedulePolling();
			}
		}
	}

	function mutate(taskId: string, operation: 'cancel' | 'remove'): Promise<void> {
		const existing = mutations.get(taskId);
		if (existing) {
			return existing;
		}
		const currentEpoch = epoch;
		const controller = new AbortController();
		writes.add(controller);
		invalidate();
		const pending = Promise.resolve().then(async () => {
			try {
				await serverTransfersApi[operation](taskId, controller.signal);
				if (currentEpoch !== epoch) {
					return;
				}
				invalidate();
				if (operation === 'remove') {
					items.value = items.value.filter((item) => item.taskId !== taskId);
				} else {
					await load({ background: true, ensureFresh: true });
				}
			} catch (cause) {
				if (currentEpoch === epoch) {
					error.value = serverTransferFailureKey(cause);
				}
			} finally {
				writes.delete(controller);
				if (currentEpoch === epoch && mutations.get(taskId) === pending) {
					mutations.delete(taskId);
					schedulePolling();
				}
			}
		});
		mutations.set(taskId, pending);
		return pending;
	}

	const cancel = (taskId: string): Promise<void> => mutate(taskId, 'cancel');

	const remove = (taskId: string): Promise<void> => mutate(taskId, 'remove');

	async function cancelAll(): Promise<void> {
		const ids = items.value
			.filter((item) => ['queued', 'in-progress'].includes(item.status))
			.map((item) => item.taskId);
		await Promise.all(ids.map(cancel));
	}

	function startPolling(intervalMs = 2000): () => void {
		stopPolling();
		pollingEnabled = true;
		pollingIntervalMs = Math.max(1000, intervalMs);
		document.addEventListener('visibilitychange', syncPollingVisibility);
		window.addEventListener('pageshow', syncPollingVisibility);
		window.addEventListener('online', syncPollingVisibility);
		window.addEventListener('offline', syncPollingVisibility);
		if (!document.hidden && navigator.onLine) void load();
		else refreshOnResume = true;
		return stopPolling;
	}

	return {
		reset,
		items,
		progressTasks,
		loading,
		error,
		sendBlocked,
		load,
		send,
		cancel,
		remove,
		cancelAll,
		startPolling,
		stopPolling,
	};
});

registerAuthenticatedSessionReset('server-transfers-cache', () => useServerTransfersStore().reset());
