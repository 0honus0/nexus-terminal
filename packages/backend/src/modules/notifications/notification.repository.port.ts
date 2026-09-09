import type {
  CreateNotificationSetting,
  NotificationEvent,
  NotificationSetting,
  UpdateNotificationSetting,
} from './notification.types';
export interface NotificationSettingsRepository {
  list(): Promise<NotificationSetting[]>;
  get(id: number): Promise<NotificationSetting | null>;
  listEnabledFor(event: NotificationEvent): Promise<NotificationSetting[]>;
  create(setting: CreateNotificationSetting): Promise<number>;
  update(id: number, setting: UpdateNotificationSetting): Promise<boolean>;
  delete(id: number): Promise<boolean>;
}
