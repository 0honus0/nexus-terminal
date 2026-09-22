export const NOTIFICATION_CHANNEL_TYPES = ['webhook', 'email', 'telegram'] as const;
export type NotificationChannelTypeDto = (typeof NOTIFICATION_CHANNEL_TYPES)[number];

export const NOTIFICATION_EVENTS = [
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
  'IP_BLOCKED',
  'NOTIFICATION_SETTING_CREATED',
  'NOTIFICATION_SETTING_UPDATED',
  'NOTIFICATION_SETTING_DELETED',
  'SSH_CONNECT_SUCCESS',
  'SSH_CONNECT_FAILURE',
  'SSH_SHELL_FAILURE',
  'DATABASE_MIGRATION',
  'ADMIN_SETUP_COMPLETE',
  'AGENT_RUN_COMPLETED',
  'AGENT_RUN_FAILED',
  'AGENT_RUN_INTERRUPTED',
  'AGENT_APPROVAL_REQUIRED',
  'AGENT_INPUT_REQUIRED',
  'AGENT_ATTENTION_REQUIRED',
] as const;
export type NotificationEventDto = (typeof NOTIFICATION_EVENTS)[number];

export interface NotificationConfigDto {
  url?: string;
  method?: 'POST' | 'GET' | 'PUT';
  headers?: Record<string, string>;
  bodyTemplate?: string;
  to?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  from?: string;
  botToken?: string;
  chatId?: string;
  messageTemplate?: string;
  customDomain?: string;
}

export interface NotificationSettingDto {
  id: number;
  channelType: NotificationChannelTypeDto;
  name: string;
  enabled: boolean;
  config: NotificationConfigDto;
  enabledEvents: NotificationEventDto[];
  createdAt: number;
  updatedAt: number;
}

export interface NotificationSettingCreateRequestDto {
  channelType: NotificationChannelTypeDto;
  name: string;
  enabled: boolean;
  config: NotificationConfigDto;
  enabledEvents: NotificationEventDto[];
}

export type NotificationSettingUpdateRequestDto = Partial<NotificationSettingCreateRequestDto>;

export interface NotificationTestRequestDto {
  channelType: NotificationChannelTypeDto;
  config: NotificationConfigDto;
}

export interface NotificationTestResponseDto {
  success: boolean;
  message: string;
}
