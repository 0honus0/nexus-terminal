import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { apiErrorMessage } from '@/client/http';
import { logger } from '@/client/logging/logger';
import { serverTransfersApi } from '../api/serverTransfersApi';
import { toTransferTask, type SendFilesRequestDto, type ServerTransferTaskDto } from '../model/serverTransfer';

export const useServerTransfersStore = defineStore('serverTransfers', () => {
	const items = ref<ServerTransferTaskDto[]>([]);
	const loading = ref(false);
	const error = ref('');
	let timer: number | undefined;
	let refreshInFlight: Promise<void> | undefined;
	let pendingRefresh = false;
	let pendingRefreshBackground = true;
	let freshnessGeneration = 0;
	let sessionGeneration = 0;

	const reset = () => {
		sessionGeneration += 1;
		freshnessGeneration += 1;
		stopPolling();
		items.value = [];
		loading.value = false;
		error.value = '';
		pendingRefresh = false;
		pendingRefreshBackground = true;
		refreshInFlight = undefined;
	};

	const progressTasks = computed(() => items.value.map(toTransferTask).sort((a, b) => b.createdAt - a.createdAt));

	const invalidateInFlightRefresh = () => {
		freshnessGeneration += 1;
	};

	type LoadOptions = { background?: boolean; ensureFresh?: boolean };

	const performLoad = async (background: boolean, generation: number): Promise<void> => {
		const showLoading = !background;
		if (showLoading) loading.value = true;
		if (generation === freshnessGeneration) error.value = '';
		try {
			const nextItems = await serverTransfersApi.list();
			// A mutation may invalidate a poll while it is still in flight. Do not let that
			// older response overwrite the optimistic/newer state before the queued refresh.
			if (generation === freshnessGeneration) items.value = nextItems;
		} catch (cause) {
			if (generation === freshnessGeneration) {
				logger.debug({ background }, 'Server transfer refresh failed');
				error.value = apiErrorMessage(cause, 'Failed to load transfer tasks.');
			}
		} finally {
			if (showLoading && generation === freshnessGeneration) loading.value = false;
		}
	};

	const runRefreshLoop = async (initialBackground: boolean): Promise<void> => {
		const epoch = sessionGeneration;
		let background = initialBackground;
		try {
			while (true) {
				pendingRefresh = false;
				pendingRefreshBackground = true;
				const generation = freshnessGeneration;
				await performLoad(background, generation);
				if (epoch !== sessionGeneration) return;
				if (!pendingRefresh) return;
				// Keep an existing foreground load visible through its queued refresh, and
				// upgrade a background refresh if any queued caller explicitly needs foreground loading.
				background = background && pendingRefreshBackground;
			}
		} finally {
			if (epoch === sessionGeneration) refreshInFlight = undefined;
		}
	};

	const load = (options: LoadOptions = {}): Promise<void> => {
		const background = Boolean(options.background);
		if (options.ensureFresh) {
			invalidateInFlightRefresh();
			if (refreshInFlight) {
				pendingRefresh = true;
				pendingRefreshBackground = pendingRefreshBackground && background;
				logger.trace({ background }, 'Server transfer refresh queued behind in-flight refresh');
				return refreshInFlight;
			}
		}
		if (refreshInFlight) return refreshInFlight;
		refreshInFlight = runRefreshLoop(background);
		return refreshInFlight;
	};

	const send = async (request: SendFilesRequestDto): Promise<ServerTransferTaskDto> => {
		const epoch = sessionGeneration;
		const task = await serverTransfersApi.send(request);
		if (epoch !== sessionGeneration) return task;
		invalidateInFlightRefresh();
		items.value = [task, ...items.value.filter((item) => item.taskId !== task.taskId)];
		logger.debug(
			{ taskId: task.taskId, status: task.status, subTaskCount: task.subTasks.length },
			'Server transfer task queued in UI',
		);
		return task;
	};

	const cancel = async (taskId: string): Promise<void> => {
		const epoch = sessionGeneration;
		const task = items.value.find((item) => item.taskId === taskId);
		logger.debug({ taskId, currentStatus: task?.status }, 'Server transfer cancellation dispatch');
		invalidateInFlightRefresh();
		if (task && !['completed', 'failed', 'partially-completed', 'cancelled'].includes(task.status)) {
			task.status = 'cancelling';
		}
		await serverTransfersApi.cancel(taskId);
		if (epoch !== sessionGeneration) return;
		void load({ background: true, ensureFresh: true });
	};

	const remove = async (taskId: string): Promise<void> => {
		const epoch = sessionGeneration;
		await serverTransfersApi.remove(taskId);
		if (epoch !== sessionGeneration) return;
		invalidateInFlightRefresh();
		items.value = items.value.filter((item) => item.taskId !== taskId);
	};

	const cancelAll = async (): Promise<void> => {
		const active = items.value.filter(
			(item) => !['completed', 'failed', 'partially-completed', 'cancelled', 'cancelling'].includes(item.status),
		);
		await Promise.allSettled(active.map((item) => cancel(item.taskId)));
	};

	const startPolling = (intervalMs = 2000): (() => void) => {
		window.clearInterval(timer);
		void load();
		timer = window.setInterval(() => void load({ background: true }), Math.max(1000, intervalMs));
		return stopPolling;
	};

	function stopPolling(): void {
		window.clearInterval(timer);
		timer = undefined;
	}

	return {
		reset,
		items,
		progressTasks,
		loading,
		error,
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
