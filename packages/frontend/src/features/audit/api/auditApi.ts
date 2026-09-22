import type { AuditLogPageDto, AuditLogQueryDto } from '@nexus-terminal/protocol/audit';
import { httpClient } from '@/client/http';

export const auditApi = {
  async list(query: AuditLogQueryDto = {}): Promise<AuditLogPageDto> {
    const params: AuditLogQueryDto = query;
    return (await httpClient.get<AuditLogPageDto>('/audit-logs', { params })).data;
  },
};
