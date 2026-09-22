import {
  AUDIT_ACTION_TYPES,
  type AuditActionTypeDto,
  type AuditLogEntryDto,
  type AuditLogPageDto,
  type AuditLogQueryDto,
} from '@nexus-terminal/protocol/audit';

export const auditActionTypes = AUDIT_ACTION_TYPES;
export type AuditActionType = AuditActionTypeDto;
export type AuditLogEntry = AuditLogEntryDto;
export type AuditLogPage = AuditLogPageDto;
export type AuditLogQuery = AuditLogQueryDto;
