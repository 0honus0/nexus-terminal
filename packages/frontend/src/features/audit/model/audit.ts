export const auditActionTypes = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOGOUT',
  'PASSWORD_CHANGED',
  '2FA_ENABLED',
  '2FA_DISABLED',
  'PASSKEY_REGISTERED',
  'PASSKEY_AUTH_SUCCESS',
  'PASSKEY_AUTH_FAILURE',
  'PASSKEY_DELETED',
  'PASSKEY_DELETE_UNAUTHORIZED',
  'PASSKEY_NAME_UPDATED',
  'PASSKEY_NAME_UPDATE_UNAUTHORIZED',
  'CONNECTION_CREATED',
  'CONNECTION_UPDATED',
  'CONNECTION_DELETED',
  'PROXY_CREATED',
  'PROXY_UPDATED',
  'PROXY_DELETED',
  'TAG_CREATED',
  'TAG_UPDATED',
  'TAG_DELETED',
  'SETTINGS_UPDATED',
  'IP_WHITELIST_UPDATED',
  'CAPTCHA_SETTINGS_UPDATED',
  'NOTIFICATION_SETTING_CREATED',
  'NOTIFICATION_SETTING_UPDATED',
  'NOTIFICATION_SETTING_DELETED',
  'SSH_CONNECT_SUCCESS',
  'SSH_CONNECT_FAILURE',
  'SSH_SHELL_FAILURE',
  'DATABASE_MIGRATION',
  'ADMIN_SETUP_COMPLETE',
  'REMOTE_DESKTOP_CONNECTING',
  'REMOTE_DESKTOP_CONNECTED',
  'REMOTE_DESKTOP_DISCONNECTED',
] as const;

export type AuditActionType = (typeof auditActionTypes)[number];

export interface AuditLogEntry {
  id: number;
  timestamp: number;
  actionType: string;
  details: unknown;
}
export interface AuditLogPage {
  logs: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}
export interface AuditLogQuery {
  limit?: number;
  offset?: number;
  search?: string;
  actionType?: string;
  startDate?: number;
  endDate?: number;
}
