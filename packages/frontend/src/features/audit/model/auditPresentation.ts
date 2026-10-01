import type { AuditLogEntryDto } from './audit';

export const auditRecord = (details: unknown): Record<string, unknown> =>
  details && typeof details === 'object' && !Array.isArray(details) ? (details as Record<string, unknown>) : {};

export const auditText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(auditText).filter(Boolean).join(', ');
  return JSON.stringify(value);
};

export const auditTone = (action: string): 'danger' | 'warning' | 'neutral' => {
  if (action.endsWith('_FAILURE')) return 'danger';
  if (action.endsWith('_UNAUTHORIZED')) return 'warning';
  return 'neutral';
};

export const auditIcon = (action: string): string => {
  if (auditTone(action) === 'danger') return 'fa-solid fa-circle-exclamation';
  if (/^(LOGIN|LOGOUT|PASSKEY|PASSWORD|2FA|ADMIN)/.test(action)) return 'fa-solid fa-shield-halved';
  if (/^(SSH|CONNECTION)/.test(action)) return 'fa-solid fa-server';
  if (action.startsWith('PROXY')) return 'fa-solid fa-network-wired';
  if (action.startsWith('TAG')) return 'fa-solid fa-tag';
  if (action.startsWith('NOTIFICATION')) return 'fa-regular fa-bell';
  if (action.startsWith('AGENT')) return 'fa-solid fa-robot';
  if (action === 'DATABASE_MIGRATION') return 'fa-solid fa-database';
  return 'fa-solid fa-sliders';
};

export const auditTarget = (log: AuditLogEntryDto): string => {
  const record = auditRecord(log.details);
  for (const key of ['connectionName', 'name', 'newName', 'credentialName', 'host', 'path']) {
    const value = auditText(record[key]);
    if (value) return value;
  }
  return '';
};

export const auditCategory = (action: string): string => {
  if (/^(LOGIN|LOGOUT|PASSKEY|PASSWORD|2FA|ADMIN)/.test(action)) return 'security';
  if (/^(SSH|CONNECTION|PROXY)/.test(action)) return 'connection';
  if (action.startsWith('AGENT')) return 'agent';
  return 'system';
};

export const auditActor = (log: AuditLogEntryDto): string => auditText(auditRecord(log.details).username);

export const auditReason = (log: AuditLogEntryDto): string => {
  const record = auditRecord(log.details);
  return auditText(record.reason ?? record.error ?? record.message);
};
