import type { AuditLogActionType } from './audit.types';
import type { AuditLogRepository } from './audit.repository.port';
export class AuditLogService {
  constructor(private readonly repository: AuditLogRepository) {}
  logAction(actionType: AuditLogActionType, details?: Record<string, unknown> | string | null) {
    return this.repository.add(actionType, details);
  }
  getLogs(
    limit = 50,
    offset = 0,
    actionType?: AuditLogActionType,
    startDate?: number,
    endDate?: number,
    searchTerm?: string,
  ) {
    return this.repository.list({ limit, offset, actionType, startDate, endDate, searchTerm });
  }
}
