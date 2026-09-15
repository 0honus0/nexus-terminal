import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiErrorMessage } from '@/client/http';
import { auditApi } from '../api/auditApi';
import type { AuditLogEntry, AuditLogQuery } from '../model/audit';

let loadGeneration = 0;
export const useAuditStore = defineStore('audit', () => {
  const logs = ref<AuditLogEntry[]>([]),
    total = ref(0),
    loading = ref(false),
    error = ref<string | null>(null);
  async function load(query: AuditLogQuery = {}) {
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
