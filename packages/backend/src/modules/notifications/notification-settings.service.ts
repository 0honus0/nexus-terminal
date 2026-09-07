import type { AuditLogService } from '../audit/audit.service';
import type { NotificationService } from './notification.service';
import type { NotificationSettingsRepository } from './notification.repository.port';
import type {
  CreateNotificationSetting,
  EmailConfig,
  NotificationChannelConfig,
  NotificationChannelType,
  TelegramConfig,
  WebhookConfig,
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
    const existing = await this.repository.get(id);
    if (!existing) return false;
    if (input.channelType !== undefined && input.channelType !== existing.channelType)
      throw new Error('通知通道类型创建后不可修改。');

    const normalized: UpdateNotificationSetting = { ...input };
    if (input.config !== undefined) normalized.config = this.mergeConfig(existing, input.config);

    const updated = await this.repository.update(id, normalized);
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
  private mergeConfig(existing: NotificationSetting, input: NotificationChannelConfig): NotificationChannelConfig {
    if (existing.channelType === 'email') {
      const previous = existing.config as EmailConfig;
      const next = input as EmailConfig;
      return {
        ...previous,
        ...next,
        ...(next.smtpPass ? { smtpPass: next.smtpPass } : previous.smtpPass ? { smtpPass: previous.smtpPass } : {}),
      };
    }
    if (existing.channelType === 'telegram') {
      const previous = existing.config as TelegramConfig;
      const next = input as TelegramConfig;
      return {
        ...previous,
        ...next,
        ...(next.botToken ? { botToken: next.botToken } : previous.botToken ? { botToken: previous.botToken } : {}),
      };
    }
    return { ...(existing.config as WebhookConfig), ...(input as WebhookConfig) };
  }

  private validate(input: UpdateNotificationSetting, partial = false) {
    if (!partial && (!input.name || !input.channelType || !input.config)) throw new Error('通知设置缺少必要字段。');
    if (input.enabledEvents !== undefined && !Array.isArray(input.enabledEvents))
      throw new Error('enabledEvents 必须是数组。');
  }
}
