import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { OperationsRequestFailure } from '@/client/operations/operations-request';
import { auditApi } from '../api/audit-api';
import type { AuditEntry, AuditQuery } from '../model/audit-types';

export const useAuditStore = defineStore('audit', () => {
	const logs = shallowRef<AuditEntry[]>([]);
	const loading = ref(false);
	const error = shallowRef<unknown>(null);
	const nextOffset = ref<number | null>(null);
	let generation = 0;
	let scope = new AbortController();
	let request: AbortController | null = null;
	let activeQuery: AuditQuery = {};

	function reset(): void {
		generation++;
		scope.abort();
		scope = new AbortController();
		request?.abort();
		request = null;
		logs.value = [];
		loading.value = false;
		error.value = null;
		nextOffset.value = null;
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
		load,

		loadMore: (permission?: AbortSignal) => read(true, permission),

		reset,
	};
});
