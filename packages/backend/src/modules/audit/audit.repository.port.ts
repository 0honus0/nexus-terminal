import type { AuditLogActionType, AuditLogEntry } from './audit.types';
export interface AuditLogRepository {
  add(actionType: AuditLogActionType, details?: Record<string, unknown> | string | null): Promise<void>;
  list(options: {
    limit: number;
    offset: number;
    actionType?: AuditLogActionType;
    startDate?: number;
    endDate?: number;
    searchTerm?: string;
  }): Promise<{ logs: AuditLogEntry[]; total: number }>;
}
