import type { AuditLogPageDto, AuditLogQueryDto } from '@nexus-terminal/protocol/audit';
import { httpClient } from '@/client/http';
import type { AuditLogPage, AuditLogQuery } from '../model/audit';

export const auditApi = {
  async list(query: AuditLogQuery = {}): Promise<AuditLogPage> {
    const params: AuditLogQueryDto = query;
    return (await httpClient.get<AuditLogPageDto>('/audit-logs', { params })).data;
  },
};
