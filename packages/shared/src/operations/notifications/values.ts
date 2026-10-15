export const NOTIFICATION_CHANNELS = ['webhook', 'email', 'telegram'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_DELIVERY_STATUSES = ['queued', 'dispatched', 'sent', 'failed', 'unknown'] as const;

export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export type NotificationDeliveryOutcome = Extract<NotificationDeliveryStatus, 'sent' | 'failed' | 'unknown'>;

export const NOTIFICATION_MAX_SETTINGS = 64;

export const NOTIFICATION_MAX_TEXT_BYTES = 16384;
