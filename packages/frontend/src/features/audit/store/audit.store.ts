import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { OperationsRequestFailure } from '@/client/operations/operations-request';
import { notificationsApi } from '@/features/notifications/public';
import type { NotificationDelivery } from '@/features/notifications/public';
import { auditApi } from '../api/audit-api';
import type { AuditEntry, AuditQuery } from '../model/audit-types';

export const useAuditStore = defineStore('audit', () => {
	const logs = shallowRef<AuditEntry[]>([]);
	const loading = ref(false);
	const error = shallowRef<unknown>(null);
	const nextOffset = ref<number | null>(null);
	const deliveries = shallowRef<NotificationDelivery[]>([]);
	const deliveriesLoading = ref(false);
	const deliveriesError = shallowRef<unknown>(null);
	const deliveriesNextOffset = ref<number | null>(null);
	let generation = 0;
	let scope = new AbortController();
	let request: AbortController | null = null;
	let activeQuery: AuditQuery = {};
	let deliveriesGeneration = 0;
	let deliveriesRequest: AbortController | null = null;

	function reset(): void {
		generation++;
		scope.abort();
		scope = new AbortController();
		request?.abort();
		deliveriesRequest?.abort();
		request = null;
		deliveriesRequest = null;
		logs.value = [];
		deliveries.value = [];
		loading.value = false;
		deliveriesLoading.value = false;
		error.value = null;
		deliveriesError.value = null;
		nextOffset.value = null;
		deliveriesNextOffset.value = null;
		deliveriesGeneration++;
		activeQuery = {};
	}

	async function read(append: boolean, permission?: AbortSignal): Promise<void> {
		if (permission?.aborted) {
			return;
		}
		if (append && (loading.value || nextOffset.value === null)) {
			return;
		}
		request?.abort();
		const current = new AbortController();
		request = current;
		const originalGeneration = ++generation;
		const signal = AbortSignal.any([scope.signal, current.signal, ...(permission ? [permission] : [])]);
		const query: AuditQuery = {
			event: activeQuery.event,
			from: activeQuery.from,
			to: activeQuery.to,
			q: activeQuery.q,
			limit: activeQuery.limit,
			offset: append ? (nextOffset.value ?? 0) : 0,
		};
		loading.value = true;
		error.value = null;
		try {
			const page = await auditApi.list(query, signal);
			if (signal.aborted || originalGeneration !== generation) {
				return;
			}
			const existing = new Set(logs.value.map((log) => log.id));
			if (append && page.items.some((log) => existing.has(log.id))) {
				throw new OperationsRequestFailure('protocol_failure', 'unknown');
			}
			logs.value = append ? [...logs.value, ...page.items] : page.items;
			nextOffset.value = page.nextOffset;
		} catch (cause) {
			if (!signal.aborted && originalGeneration === generation) {
				error.value = cause;
			}
		} finally {
			if (request === current) {
				request = null;
				loading.value = false;
			}
		}
	}

	async function readDeliveries(append: boolean, permission?: AbortSignal): Promise<void> {
		if (permission?.aborted) {
			return;
		}
		if (append && (deliveriesLoading.value || deliveriesNextOffset.value === null)) {
			return;
		}
		deliveriesRequest?.abort();
		const current = new AbortController();
		deliveriesRequest = current;
		const originalGeneration = ++deliveriesGeneration;
		const signal = AbortSignal.any([scope.signal, current.signal, ...(permission ? [permission] : [])]);
		const offset = append ? (deliveriesNextOffset.value ?? 0) : 0;
		deliveriesLoading.value = true;
		deliveriesError.value = null;
		try {
			const page = await notificationsApi.deliveries(offset, 40, signal);
			if (signal.aborted || originalGeneration !== deliveriesGeneration) {
				return;
			}
			const existing = new Set(deliveries.value.map((delivery) => delivery.id));
			if (append && page.items.some((delivery) => existing.has(delivery.id))) {
				throw new OperationsRequestFailure('protocol_failure', 'unknown');
			}
			deliveries.value = append ? [...deliveries.value, ...page.items] : page.items;
			deliveriesNextOffset.value = page.nextOffset;
		} catch (cause) {
			if (!signal.aborted && originalGeneration === deliveriesGeneration) {
				deliveriesError.value = cause;
			}
		} finally {
			if (deliveriesRequest === current) {
				deliveriesRequest = null;
				deliveriesLoading.value = false;
			}
		}
	}

	function loadDeliveries(permission?: AbortSignal): Promise<void> {
		if (permission?.aborted) {
			return Promise.resolve();
		}
		deliveriesRequest?.abort();
		deliveries.value = [];
		deliveriesNextOffset.value = null;
		return readDeliveries(false, permission);
	}

	function load(query: AuditQuery = {}, permission?: AbortSignal): Promise<void> {
		if (permission?.aborted) {
			return Promise.resolve();
		}
		activeQuery = { event: query.event, from: query.from, to: query.to, q: query.q, limit: query.limit, offset: 0 };
		logs.value = [];
		nextOffset.value = null;
		return read(false, permission);
	}

	return {
		logs,
		loading,
		error,
		hasMore: computed(() => nextOffset.value !== null),
		deliveries,
		deliveriesLoading,
		deliveriesError,
		deliveriesHasMore: computed(() => deliveriesNextOffset.value !== null),
		load,

		loadMore: (permission?: AbortSignal) => read(true, permission),

		loadDeliveries,

		loadMoreDeliveries: (permission?: AbortSignal) => readDeliveries(true, permission),

		reset,
	};
});
