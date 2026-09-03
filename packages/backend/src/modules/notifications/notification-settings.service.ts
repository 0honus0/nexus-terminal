import type { AuditLogService } from '../audit/audit.service';
import type { NotificationService } from './notification.service';
import type { NotificationSettingsRepository } from './notification.repository.port';
import type {
  CreateNotificationSetting,
  NotificationChannelConfig,
  NotificationChannelType,
  NotificationSetting,
  UpdateNotificationSetting,
} from './notification.types';
export class NotificationSettingsService {
  constructor(
    private readonly repository: NotificationSettingsRepository,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}
  list(): Promise<NotificationSetting[]> {
    return this.repository.list();
  }
  get(id: number) {
    return this.repository.get(id);
  }
  async create(input: CreateNotificationSetting) {
    this.validate(input);
    const id = await this.repository.create(input);
    const setting = await this.repository.get(id);
    if (!setting) throw new Error('创建通知设置后无法检索。');
    const details = { settingId: id, name: setting.name, type: setting.channelType };
    await this.audit.logAction('NOTIFICATION_SETTING_CREATED', details);
    await this.notifications.publish('NOTIFICATION_SETTING_CREATED', details).catch(() => undefined);
    return id;
  }
  async update(id: number, input: UpdateNotificationSetting) {
    this.validate(input, true);
    const updated = await this.repository.update(id, input);
    if (!updated) return false;
    const details = { settingId: id, updatedFields: Object.keys(input) };
    await this.audit.logAction('NOTIFICATION_SETTING_UPDATED', details);
    await this.notifications.publish('NOTIFICATION_SETTING_UPDATED', details).catch(() => undefined);
    return true;
  }
  async delete(id: number) {
    const setting = await this.repository.get(id);
    if (!setting) return false;
    const deleted = await this.repository.delete(id);
    if (!deleted) return false;
    const details = { settingId: id, name: setting.name, type: setting.channelType };
    await this.audit.logAction('NOTIFICATION_SETTING_DELETED', details);
    await this.notifications.publish('NOTIFICATION_SETTING_DELETED', details).catch(() => undefined);
    return true;
  }
  test(channelType: NotificationChannelType, config: NotificationChannelConfig) {
    return this.notifications.testChannel(channelType, config);
  }
  private validate(input: UpdateNotificationSetting, partial = false) {
    if (!partial && (!input.name || !input.channelType || !input.config)) throw new Error('通知设置缺少必要字段。');
    if (input.enabledEvents !== undefined && !Array.isArray(input.enabledEvents))
      throw new Error('enabledEvents 必须是数组。');
  }
}
