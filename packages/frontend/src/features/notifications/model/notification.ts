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
export type NotificationConfig = Record<string, string | number | boolean | Record<string, string> | undefined>;
export interface NotificationSetting {
  id: number;
  channelType: NotificationChannelType;
  name: string;
  enabled: boolean;
  config: NotificationConfig;
  enabledEvents: NotificationEvent[];
  createdAt: number;
  updatedAt: number;
}
export interface NotificationSettingInput {
  channelType: NotificationChannelType;
  name: string;
  enabled: boolean;
  config: NotificationConfig;
  enabledEvents: NotificationEvent[];
}
