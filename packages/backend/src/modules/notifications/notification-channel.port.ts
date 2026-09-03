import type {
  NotificationChannelConfig,
  NotificationChannelType,
  NotificationTestResult,
  PreparedNotification,
} from './notification.types';
export interface NotificationChannelPort {
  send(notification: PreparedNotification): Promise<void>;
  test(channelType: NotificationChannelType, config: NotificationChannelConfig): Promise<NotificationTestResult>;
}
