import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import { apiErrorMessage } from '@/client/http';
import { auditApi } from '../api/auditApi';
import type { AuditLogEntryDto, AuditLogQueryDto } from '../model/audit';

export const useAuditStore = defineStore('audit', () => {
	let loadGeneration = 0;
	let activeQuery: AuditLogQueryDto = {};
	let nextOffset = 0;
	const hasMore = ref(false);
	const logs = shallowRef<AuditLogEntryDto[]>([]),
		total = ref(0),
		loading = ref(false),
		error = ref<string | null>(null);

	async function load(query: AuditLogQueryDto = {}) {
		const generation = ++loadGeneration;
		activeQuery = { ...query, offset: 0 };
		nextOffset = 0;
		logs.value = [];
		total.value = 0;
		hasMore.value = false;
		loading.value = true;
		error.value = null;
		try {
			const page = await auditApi.list(activeQuery);
			if (generation !== loadGeneration) return;
			logs.value = page.logs;
			total.value = page.total;
			nextOffset = page.logs.length;
			hasMore.value = page.logs.length > 0 && nextOffset < page.total;
		} catch (e) {
			if (generation === loadGeneration) error.value = apiErrorMessage(e, 'audit-load-error');
		} finally {
			if (generation === loadGeneration) loading.value = false;
		}
	}

	async function loadMore() {
		if (loading.value || !hasMore.value) return;
		const generation = loadGeneration;
		loading.value = true;
		error.value = null;
		try {
			const page = await auditApi.list({ ...activeQuery, offset: nextOffset });
			if (generation !== loadGeneration) return;
			const ids = new Set(logs.value.map((log) => log.id));
			logs.value = [...logs.value, ...page.logs.filter((log) => !ids.has(log.id))];
			nextOffset += page.logs.length;
			total.value = page.total;
			hasMore.value = page.logs.length > 0 && nextOffset < page.total;
		} catch (e) {
			if (generation === loadGeneration) error.value = apiErrorMessage(e, 'audit-load-error');
		} finally {
			if (generation === loadGeneration) loading.value = false;
		}
	}

	function reset() {
		loadGeneration += 1;
		logs.value = [];
		total.value = 0;
		loading.value = false;
		error.value = null;
		hasMore.value = false;
		nextOffset = 0;
		activeQuery = {};
	}

	return { logs, total, loading, error, hasMore, load, loadMore, reset };
});
