import type { SettingsService } from '../settings/settings.service';
import type { NotificationChannelPort } from './notification-channel.port';
import type { NotificationFormatter } from './notification-formatter.service';
import type { NotificationSettingsRepository } from './notification.repository.port';
import type {
  NotificationChannelConfig,
  NotificationChannelType,
  NotificationEvent,
  NotificationSetting,
  NotificationTestResult,
} from './notification.types';

/** Fire-and-observe application service for domain notifications; channel failures are isolated per setting. */
export class NotificationService {
  constructor(
    private readonly repository: NotificationSettingsRepository,
    private readonly channels: NotificationChannelPort,
    private readonly formatter: NotificationFormatter,
    private readonly settings: SettingsService,
  ) {}
  async publish(event: NotificationEvent, details?: Record<string, unknown> | string): Promise<void> {
    const [applicable, timezone] = await Promise.all([
      this.repository.listEnabledFor(event),
      this.settings.getSetting('timezone'),
    ]);
    if (!applicable.length) return;
    const payload = { event, timestamp: Date.now(), details };
    await Promise.allSettled(
      applicable.map((setting) => this.channels.send(this.formatter.prepare(setting, payload, timezone || 'UTC'))),
    );
  }
  sendNotification(event: NotificationEvent, details?: Record<string, unknown> | string) {
    return this.publish(event, details);
  }

  async testChannel(
    channelType: NotificationChannelType,
    config: NotificationChannelConfig,
  ): Promise<NotificationTestResult> {
    try {
      const timezone = (await this.settings.getSetting('timezone')) || 'UTC';
      const setting: NotificationSetting = {
        id: -1,
        channelType,
        name: 'Nexus Terminal Test Notification',
        enabled: true,
        config,
        enabledEvents: ['SETTINGS_UPDATED'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const details = {
        message: `This is a test notification from Nexus Terminal (${channelType}).`,
        test: true,
      };
      const prepared = this.formatter.prepare(
        setting,
        { event: 'SETTINGS_UPDATED', timestamp: Date.now(), details },
        timezone,
      );
      if (channelType === 'email') prepared.subject = 'Nexus Terminal Test Notification';
      await this.channels.send(prepared);
      return { success: true, message: '测试通知发送成功！' };
    } catch (error) {
      return {
        success: false,
        message: `测试通知发送失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
