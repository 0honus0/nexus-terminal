// 类型定义：用于服务器状态监控数据 (从 useStatusMonitor 迁移)
export interface ServerStatus {
  cpuPercent?: number;
  memPercent?: number;
  memUsed?: number; // MB
  memTotal?: number; // MB
  diskPercent?: number;
  diskUsed?: number; // KB
  diskTotal?: number; // KB
  cpuModel?: string;
  swapPercent?: number;
  swapUsed?: number; // MB
  swapTotal?: number; // MB
  netRxRate?: number; // Bytes/sec
  netTxRate?: number; // Bytes/sec
  netInterface?: string;
  osName?: string;
}

// 可以根据需要添加其他与服务器或连接状态相关的类型

// --- Notification Settings Types (Mirrors backend/src/types/notification.types.ts) ---

export type NotificationChannelType = 'webhook' | 'email' | 'telegram';

// Align NotificationEvent with backend AppEventType
export type NotificationEvent =
  // 认证事件
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | '2FA_ENABLED'
  | '2FA_DISABLED'
  | 'PASSKEY_REGISTERED'
  | 'PASSKEY_AUTH_SUCCESS'
  | 'PASSKEY_AUTH_FAILURE'
  | 'PASSKEY_DELETED'
  // 连接与配置事件
  | 'CONNECTION_CREATED'
  | 'CONNECTION_UPDATED'
  | 'CONNECTION_DELETED'
  | 'PROXY_CREATED'
  | 'PROXY_UPDATED'
  | 'PROXY_DELETED'
  | 'TAG_CREATED'
  | 'TAG_UPDATED'
  | 'TAG_DELETED'
  | 'SETTINGS_UPDATED'
  | 'IP_WHITELIST_UPDATED'
  | 'IP_BLOCKED'
  | 'NOTIFICATION_SETTING_CREATED'
  | 'NOTIFICATION_SETTING_UPDATED'
  | 'NOTIFICATION_SETTING_DELETED'
  // SSH 会话事件
  | 'SSH_CONNECT_SUCCESS'
  | 'SSH_CONNECT_FAILURE'
  | 'SSH_SHELL_FAILURE'
  | 'SSH_DISCONNECT'
  | 'SSH_SESSION_SUSPENDED'
  // 批量任务事件
  | 'BATCH_TASK_CREATED'
  | 'BATCH_TASK_COMPLETED'
  | 'BATCH_TASK_FAILED'
  | 'BATCH_TASK_CANCELLED'
  // 备份事件
  | 'BACKUP_EXPORT_COMPLETED'
  | 'BACKUP_EXPORT_FAILED'
  | 'BACKUP_IMPORT_COMPLETED'
  | 'BACKUP_IMPORT_FAILED'
  // Docker 事件
  | 'DOCKER_CONTAINER_STARTED'
  | 'DOCKER_CONTAINER_STOPPED'
  | 'DOCKER_CONTAINER_REMOVED'
  | 'DOCKER_CONTAINER_COMMAND_FAILED'
  // SFTP 事件
  | 'SFTP_CONNECT_SUCCESS'
  | 'SFTP_CONNECT_FAILURE'
  // 系统事件
  | 'DATABASE_MIGRATION'
  | 'ADMIN_SETUP_COMPLETE';

export interface WebhookConfig {
  url: string;
  method?: 'POST' | 'GET' | 'PUT';
  headers?: Record<string, string>;
  bodyTemplate?: string;
}

export interface EmailConfig {
  to: string;
  subjectTemplate?: string;
  // SMTP settings are global on the backend
}

export interface TelegramConfig {
  botToken: string; // Consider masking this in the UI
  chatId: string;
  messageTemplate?: string;
  customDomain?: string; // 允许用户自定义 Telegram API 域名
}

export type NotificationChannelConfig = WebhookConfig | EmailConfig | TelegramConfig;

export interface NotificationSetting {
  id?: number;
  channel_type: NotificationChannelType;
  name: string;
  enabled: boolean;
  config: NotificationChannelConfig;
  enabled_events: NotificationEvent[];
  created_at?: number | string; // Represented as string or number (timestamp)
  updated_at?: number | string;
}

// Helper type for creating/updating settings, omitting generated fields
export type NotificationSettingData = Omit<NotificationSetting, 'id' | 'created_at' | 'updated_at'>;

// --- Audit Log Types (Mirrors backend/src/types/audit.types.ts) ---

// Keep action types aligned with backend for potential filtering
export type AuditLogActionType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | '2FA_ENABLED'
  | '2FA_DISABLED'
  | 'CONNECTION_CREATED'
  | 'CONNECTION_UPDATED'
  | 'CONNECTION_DELETED'
  | 'PROXY_CREATED'
  | 'PROXY_UPDATED'
  | 'PROXY_DELETED'
  | 'TAG_CREATED'
  | 'TAG_UPDATED'
  | 'TAG_DELETED'
  | 'SETTINGS_UPDATED'
  | 'IP_WHITELIST_UPDATED'
  | 'NOTIFICATION_SETTING_CREATED'
  | 'NOTIFICATION_SETTING_UPDATED'
  | 'NOTIFICATION_SETTING_DELETED'
  // SSH Actions
  | 'SSH_CONNECT_SUCCESS'
  | 'SSH_CONNECT_FAILURE'
  | 'SSH_SHELL_FAILURE'
  | 'SSH_DISCONNECT'
  | 'SSH_SESSION_SUSPENDED'
  // File Transfer
  | 'FILE_UPLOAD'
  | 'FILE_DOWNLOAD'
  // Command Security
  | 'COMMAND_BLOCKED'
  // Tags
  | 'CONNECTIONS_TAG_ADDED'
  | 'CONNECTIONS_TAG_REMOVED'
  // Settings
  | 'CAPTCHA_SETTINGS_UPDATED'
  // Remote Desktop
  | 'REMOTE_DESKTOP_CONNECTING'
  | 'REMOTE_DESKTOP_CONNECTED'
  | 'REMOTE_DESKTOP_DISCONNECTED'
  // System/Error
  | 'DATABASE_MIGRATION'
  | 'ADMIN_SETUP_COMPLETE';
// Settings (Specific)
// | 'FOCUS_SWITCHER_SEQUENCE_UPDATED'; // Removed Focus Switcher type

// Structure for a single log entry received from the API
export interface AuditLogEntry {
  id: number;
  timestamp: number; // Unix timestamp (seconds)
  action_type: AuditLogActionType;
  details: Record<string, unknown> | { raw: string; parseError: boolean } | null; // Parsed JSON or raw string with error flag
}

// Structure for the API response when fetching logs
export interface AuditLogApiResponse {
  logs: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}
