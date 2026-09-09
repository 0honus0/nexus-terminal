import { httpClient } from '@/client/http';
import type { AuditLogPage, AuditLogQuery } from '../model/audit';

export const auditApi = {
  async list(query: AuditLogQuery = {}): Promise<AuditLogPage> {
    return (
      await httpClient.get<AuditLogPage>('/audit-logs', {
        params: {
          limit: query.limit,
          offset: query.offset,
          search: query.search,
          actionType: query.actionType,
          startDate: query.startDate,
          endDate: query.endDate,
        },
      })
    ).data;
  },
};
