import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiErrorMessage } from '@/client/http';
import { auditApi } from '../api/auditApi';
import type { AuditLogEntryDto, AuditLogQueryDto } from '../model/audit';

export const useAuditStore = defineStore('audit', () => {
  let loadGeneration = 0;
  const logs = ref<AuditLogEntryDto[]>([]),
    total = ref(0),
    loading = ref(false),
    error = ref<string | null>(null);
  async function load(query: AuditLogQueryDto = {}) {
    const generation = loadGeneration;
    loading.value = true;
    error.value = null;
    try {
      const page = await auditApi.list(query);
      if (generation !== loadGeneration) return;
      logs.value = page.logs;
      total.value = page.total;
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
  }
  return { logs, total, loading, error, load, reset };
});
