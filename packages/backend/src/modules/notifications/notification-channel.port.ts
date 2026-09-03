import type { PreparedNotification } from './notification.types';

export interface NotificationChannelPort {
  send(notification: PreparedNotification): Promise<void>;
}
