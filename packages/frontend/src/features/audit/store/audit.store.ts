import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiErrorMessage } from '@/client/http';
import { auditApi } from '../api/auditApi';
import type { AuditLogEntry, AuditLogQuery } from '../model/audit';
export const useAuditStore = defineStore('audit', () => {
  const logs = ref<AuditLogEntry[]>([]),
    total = ref(0),
    loading = ref(false),
    error = ref<string | null>(null);
  async function load(query: AuditLogQuery = {}) {
    loading.value = true;
    error.value = null;
    try {
      const page = await auditApi.list(query);
      logs.value = page.logs;
      total.value = page.total;
    } catch (e) {
      error.value = apiErrorMessage(e, 'audit-load-error');
    } finally {
      loading.value = false;
    }
  }
  return { logs, total, loading, error, load };
});
