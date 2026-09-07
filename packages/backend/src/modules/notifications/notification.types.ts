export type NotificationChannelType = 'webhook' | 'email' | 'telegram';
export type NotificationEvent =
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
  | 'SSH_CONNECT_SUCCESS'
  | 'SSH_CONNECT_FAILURE'
  | 'SSH_SHELL_FAILURE'
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
  bodyTemplate?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  from?: string;
}
export interface TelegramConfig {
  botToken: string;
  chatId: string;
  messageTemplate?: string;
  customDomain?: string;
}
export type NotificationChannelConfig = WebhookConfig | EmailConfig | TelegramConfig;

export interface NotificationSetting {
  id: number;
  channelType: NotificationChannelType;
  name: string;
  enabled: boolean;
  config: NotificationChannelConfig;
  enabledEvents: NotificationEvent[];
  createdAt: number;
  updatedAt: number;
}
export type CreateNotificationSetting = Omit<NotificationSetting, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateNotificationSetting = Partial<CreateNotificationSetting>;
export interface NotificationPayload {
  event: NotificationEvent;
  timestamp: number;
  details?: Record<string, unknown> | string;
}
export interface PreparedNotification {
  channelType: NotificationChannelType;
  config: NotificationChannelConfig;
  subject?: string;
  body: string;
  payload: NotificationPayload;
}
export interface NotificationTestResult {
  success: boolean;
  message: string;
}
