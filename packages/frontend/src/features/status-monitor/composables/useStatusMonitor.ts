import { logger } from '@/client/logging/logger';
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowReadonly } from 'vue';
import type { StatusChannel } from '../ports/status-channel';
import {
	StatusFailure,
	type StatusFailureCode,
	type StatusMonitorSessionController,
	type StatusSample,
	type StatusHistory,
	type StatusHistoryPoint,
} from '../model/status-types';

const emptyHistory = (): StatusHistory => ({ cpu: [], memory: [], swap: [], disk: [], networkRx: [], networkTx: [] });

export function createStatusMonitorSession(channel: StatusChannel, maxSamples = 1800): StatusMonitorSessionController {
	const current = ref<StatusSample | null>(null);
	const error = ref<StatusFailureCode | null>(null);
	const history = ref<StatusHistory>(emptyHistory());
	let sequence = 0;
	let consumerCount = 0;
	let workspaceAvailable = false;
	let sampling = false;
	let disposed = false;
	let generation = 0;
	let operation = Promise.resolve();

	const desiredSampling = (): boolean => !disposed && workspaceAvailable && consumerCount > 0;

	const push = (list: StatusHistoryPoint[], time: number, value: number | undefined): void => {
		if (value === undefined) {
			return;
		}
		list.push({ time, value, sequence });
		if (list.length > maxSamples) {
			list.splice(0, list.length - maxSamples);
		}
	};

	const stopEvents = channel.subscribe(
		(sample) => {
			if (!desiredSampling()) {
				return;
			}
			current.value = sample;
			error.value = null;
			sequence += 1;
			push(history.value.cpu, sample.timestamp, sample.cpuPercent);
			push(history.value.memory, sample.timestamp, sample.memPercent);
			push(history.value.swap, sample.timestamp, sample.swapPercent);
			push(history.value.disk, sample.timestamp, sample.diskPercent);
			push(history.value.networkRx, sample.timestamp, sample.netRxRate);
			push(history.value.networkTx, sample.timestamp, sample.netTxRate);
		},
		(failure) => {
			if (desiredSampling()) {
				error.value = failure.code;
			}
		},
	);

	const syncSampling = (): Promise<void> => {
		const owner = generation;
		const next = operation
			.then(async () => {
				if (owner !== generation) {
					return;
				}
				const desired = desiredSampling();
				if (desired === sampling) {
					return;
				}
				if (!desired) {
					sampling = false;
					if (workspaceAvailable) {
						await channel.stop();
					}
					return;
				}
				sampling = true;
				await channel.start();
			})
			.catch((cause) => {
				const code = cause instanceof StatusFailure ? cause.code : 'remote_unavailable';
				if (owner !== generation || disposed) {
					logger.warn(
						{ reason: code, failureKind: 'status_subscription_cleanup' },
						'Status subscription settled after its consumer ended',
					);
					return;
				}
				error.value = code;
			});
		operation = next;
		return next;
	};

	const activate = (): void => {
		if (disposed) {
			return;
		}
		consumerCount += 1;
		if (consumerCount === 1) {
			void syncSampling();
		}
	};

	const deactivate = (): void => {
		if (consumerCount === 0) {
			return;
		}
		consumerCount -= 1;
		if (consumerCount === 0) {
			void syncSampling();
		}
	};

	const workspaceConnected = async (): Promise<void> => {
		if (disposed) {
			return;
		}
		workspaceAvailable = true;
		await syncSampling();
	};

	const workspaceDisconnected = (): void => {
		generation += 1;
		workspaceAvailable = false;
		sampling = false;
		current.value = null;
		error.value = null;
		history.value = emptyHistory();
	};

	const dispose = (): void => {
		if (disposed) {
			return;
		}
		disposed = true;
		consumerCount = 0;
		stopEvents();
		// Serial stop retains the original subscription until an in-flight start settles.
		void syncSampling();
	};

	return {
		current: shallowReadonly(current),
		error: shallowReadonly(error),
		history: shallowReadonly(history),
		available: computed(() => Boolean(current.value)),
		activate,
		deactivate,
		workspaceConnected,
		workspaceDisconnected,
		dispose,
	};
}

export function useStatusMonitor(controller: StatusMonitorSessionController) {
	let active = false;

	const activate = (): void => {
		if (active) {
			return;
		}
		active = true;
		controller.activate();
	};

	const deactivate = (): void => {
		if (!active) {
			return;
		}
		active = false;
		controller.deactivate();
	};

	onMounted(activate);
	onActivated(activate);
	onDeactivated(deactivate);
	onBeforeUnmount(deactivate);
	return controller;
}
