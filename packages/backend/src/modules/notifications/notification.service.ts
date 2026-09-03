import type { SettingsService } from '../settings/settings.service';
import type { NotificationChannelPort } from './notification-channel.port';
import type { NotificationFormatter } from './notification-formatter.service';
import type { NotificationSettingsRepository } from './notification.repository.port';
import type { NotificationEvent } from './notification.types';

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
}
