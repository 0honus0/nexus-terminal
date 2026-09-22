import {
  AUDIT_ACTION_TYPES,
  type AuditActionTypeDto,
  type AuditLogEntryDto,
  type AuditLogPageDto,
  type AuditLogQueryDto,
} from '@nexus-terminal/protocol/audit';
export type { AuditActionTypeDto, AuditLogEntryDto, AuditLogPageDto, AuditLogQueryDto };

export const auditActionTypes = AUDIT_ACTION_TYPES;
