import type { ProcessedNotification } from './notification.processor.service';

export interface INotificationSender {
  send(notification: ProcessedNotification): Promise<void>;
}
