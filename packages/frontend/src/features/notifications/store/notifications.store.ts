import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { OperationsRequestFailure } from '@/client/operations/operations-request';
import { notificationsApi } from '../api/notifications-api';
import { snapshotNotificationChange, toNotificationConfig } from '../model/notification-mapper';
import type {
	NotificationSetting,
	NotificationChange,
	NotificationConfigChange,
	NotificationDelivery,
} from '../model/notification-types';

export const useNotificationsStore = defineStore('notifications', () => {
	const items = shallowRef<NotificationSetting[]>([]);
	const deliveries = shallowRef<NotificationDelivery[]>([]);
	const nextOffset = ref<number | null>(null);
	const error = shallowRef<unknown>(null);
	const needsRefresh = ref(true);
	const pending = ref(0);
	let scope = new AbortController();
	let failureRevision = 0;
	let queue: Promise<unknown> = Promise.resolve();

	function reset(): void {
		scope.abort();
		scope = new AbortController();
		failureRevision++;
		queue = Promise.resolve();
		items.value = [];
		deliveries.value = [];
		nextOffset.value = null;
		pending.value = 0;
		error.value = null;
		needsRefresh.value = true;
	}

	function enqueue<T>(work: (signal: AbortSignal) => Promise<T>, permission?: AbortSignal): Promise<T> {
		const original = scope.signal;
		const signal = permission ? AbortSignal.any([original, permission]) : original;
		pending.value++;
		const task = queue
			.then(() => {
				if (signal.aborted) {
					throw new OperationsRequestFailure('cancelled', 'not_dispatched');
				}
				return work(signal);
			})
			.finally(() => {
				if (scope.signal === original) {
					pending.value--;
				}
			});
		queue = task.catch(() => undefined);
		return task;
	}

	function load(recover = false, permission?: AbortSignal): Promise<void> {
		const revision = failureRevision;
		return enqueue(async (signal) => {
			if (error.value && needsRefresh.value && !recover) {
				throw new OperationsRequestFailure('refresh_required', 'not_dispatched');
			}
			const incoming = await notificationsApi.list(signal);
			if (signal.aborted) {
				throw new OperationsRequestFailure('cancelled', 'not_dispatched');
			}
			if (revision !== failureRevision) {
				throw new OperationsRequestFailure('refresh_required', 'not_dispatched');
			}
			items.value = incoming;
			needsRefresh.value = false;
			error.value = null;
		}, permission).catch((cause) => {
			// Cancellation belongs to the captured scope; do not publish it into a replacement session.
			if (!permission?.aborted && revision === failureRevision) {
				error.value = cause;
				needsRefresh.value = true;
			}
			throw cause;
		});
	}

	function mutate<T>(
		work: (signal: AbortSignal) => Promise<T>,
		publish: (value: T) => void,
		permission?: AbortSignal,
	): Promise<T> {
		const original = scope.signal;
		return enqueue(async (signal) => {
			if (needsRefresh.value) {
				throw new OperationsRequestFailure('refresh_required', 'not_dispatched');
			}
			try {
				const value = await work(signal);
				if (scope.signal === original && !original.aborted) {
					publish(value);
				}
				return value;
			} catch (cause) {
				// An aborted view can still have committed; keep that fact in the session owner.
				if (
					scope.signal === original &&
					!original.aborted &&
					!(cause instanceof OperationsRequestFailure && cause.outcome === 'not_dispatched')
				) {
					error.value = cause;
					needsRefresh.value = true;
					failureRevision++;
				}
				throw cause;
			}
		}, permission);
	}

	function save(
		change: NotificationChange,
		original: { id: string; version: number } | null,
		permission?: AbortSignal,
	): Promise<NotificationSetting> {
		const frozen = snapshotNotificationChange(change);
		const id = original?.id;
		const version = original?.version ?? 0;
		return mutate(
			(signal) =>
				id === undefined
					? notificationsApi.create(frozen, signal)
					: notificationsApi.update(id, version, frozen, signal),
			(saved) => {
				items.value = items.value.filter((item) => item.id !== saved.id).concat(saved);
			},
			permission,
		);
	}

	function remove(id: string, version: number, permission?: AbortSignal): Promise<void> {
		return mutate(
			(signal) => notificationsApi.remove(id, version, signal),
			() => {
				items.value = items.value.filter((item) => item.id !== id);
			},
			permission,
		);
	}

	function testSaved(id: string, permission?: AbortSignal): Promise<NotificationDelivery> {
		return mutate(
			(signal) => notificationsApi.testSaved(id, signal),
			(delivery) => {
				deliveries.value = [delivery, ...deliveries.value.filter((item) => item.id !== delivery.id)];
			},
			permission,
		);
	}

	function testUnsaved(config: NotificationConfigChange, permission?: AbortSignal): Promise<NotificationDelivery> {
		const frozen = toNotificationConfig(config);
		return mutate(
			(signal) => notificationsApi.testUnsaved(frozen, signal),
			(delivery) => {
				deliveries.value = [delivery, ...deliveries.value.filter((item) => item.id !== delivery.id)];
			},
			permission,
		);
	}

	function loadDeliveries(append = false, permission?: AbortSignal): Promise<void> {
		return enqueue(async (signal) => {
			const offset = append ? nextOffset.value : 0;
			if (offset === null) {
				return;
			}
			const page = await notificationsApi.deliveries(offset, 40, signal);
			if (signal.aborted) {
				throw new OperationsRequestFailure('cancelled', 'not_dispatched');
			}
			if (append && page.items.some((item) => deliveries.value.some((old) => old.id === item.id))) {
				throw new OperationsRequestFailure('protocol_failure', 'unknown');
			}
			deliveries.value = append ? [...deliveries.value, ...page.items] : page.items;
			nextOffset.value = page.nextOffset;
		}, permission);
	}

	return {
		items,
		deliveries,
		nextOffset,
		error,
		needsRefresh,
		loading: computed(() => pending.value > 0),
		load,
		reset,
		save,
		remove,
		testSaved,
		testUnsaved,
		loadDeliveries,
	};
});
