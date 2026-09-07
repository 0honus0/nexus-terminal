import type { SettingsService } from '../settings/settings.service';
import type { NotificationChannelPort } from './notification-channel.port';
import type { NotificationFormatter } from './notification-formatter.service';
import type { NotificationLocalizer } from './notification-localizer.port';
import type { NotificationSettingsRepository } from './notification.repository.port';
import type {
  EmailConfig,
  NotificationChannelConfig,
  NotificationChannelType,
  NotificationEvent,
  NotificationSetting,
  NotificationTestResult,
  TelegramConfig,
} from './notification.types';

/** Fire-and-observe application service for domain notifications; channel failures are isolated per setting. */
export class NotificationService {
  constructor(
    private readonly repository: NotificationSettingsRepository,
    private readonly channels: NotificationChannelPort,
    private readonly formatter: NotificationFormatter,
    private readonly localizer: NotificationLocalizer,
    private readonly settings: SettingsService,
  ) {}

  async publish(event: NotificationEvent, details?: Record<string, unknown> | string): Promise<void> {
    const [applicable, timezone, language] = await Promise.all([
      this.repository.listEnabledFor(event),
      this.settings.getSetting('timezone'),
      this.settings.getSetting('language'),
    ]);
    if (!applicable.length) return;
    const locale = this.localizer.resolveLocale(language);
    const payload = { event, timestamp: Date.now(), details: this.localizeDetails(details, locale) };
    await Promise.allSettled(
      applicable.map((setting) =>
        this.channels.send(this.formatter.prepare(setting, payload, timezone || 'UTC', locale)),
      ),
    );
  }

  sendNotification(event: NotificationEvent, details?: Record<string, unknown> | string) {
    return this.publish(event, details);
  }

  async testChannel(
    channelType: NotificationChannelType,
    config: NotificationChannelConfig,
  ): Promise<NotificationTestResult> {
    let locale = this.localizer.defaultLocale;
    try {
      const [timezoneSetting, languageSetting] = await Promise.all([
        this.settings.getSetting('timezone'),
        this.settings.getSetting('language'),
      ]);
      const timezone = timezoneSetting || 'UTC';
      locale = this.localizer.resolveLocale(languageSetting);
      const timestamp = Date.now();
      const event: NotificationEvent = 'SETTINGS_UPDATED';
      const eventDisplay = this.localizer.translate(locale, `event.${event}`, event);
      const preparedConfig = this.prepareTestConfig(channelType, config, locale);
      const setting: NotificationSetting = {
        id: -1,
        channelType,
        name: 'Nexus Terminal Test Notification',
        enabled: true,
        config: preparedConfig,
        enabledEvents: [event],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const details = {
        message: this.testDetailsMessage(channelType, locale, eventDisplay),
        test: true,
      };
      const prepared = this.formatter.prepare(setting, { event, timestamp, details }, timezone, locale);
      if (channelType === 'email') {
        prepared.subject = this.localizer.translate(
          locale,
          'testNotification.subject',
          'Nexus Terminal Test Notification ({eventDisplay})',
          { event: eventDisplay, eventDisplay },
        );
      }
      await this.channels.send(prepared);
      return {
        success: true,
        message: this.localizer.translate(locale, 'notification.test.success', 'Test notification sent successfully.'),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: this.localizer.translate(locale, 'notification.test.failure', 'Test notification failed: {error}', {
          error: message,
        }),
      };
    }
  }

  private prepareTestConfig(
    channelType: NotificationChannelType,
    config: NotificationChannelConfig,
    locale: string,
  ): NotificationChannelConfig {
    if (channelType === 'email') {
      const email = config as EmailConfig;
      if (email.bodyTemplate) return email;
      return {
        ...email,
        bodyTemplate: this.localizer.translate(
          locale,
          'testNotification.email.bodyHtml',
          "<p>This is a test email from <b>Nexus Terminal</b> for event '{eventDisplay}'.</p><p>If you received this, your SMTP configuration is working.</p><p>Timestamp: {timestamp}</p>",
          { event: '{eventDisplay}', eventDisplay: '{eventDisplay}', timestamp: '{timestamp}' },
        ),
      };
    }
    if (channelType === 'telegram') {
      const telegram = config as TelegramConfig;
      if (telegram.messageTemplate) return telegram;
      return {
        ...telegram,
        messageTemplate: this.localizer.translate(
          locale,
          'testNotification.telegram.bodyTemplate',
          '*Nexus Terminal Test Notification*\nEvent: `{eventDisplay}`\nTimestamp: {timestamp}\nDetails:\n```\n{details}\n```',
          {
            event: '{eventDisplay}',
            eventDisplay: '{eventDisplay}',
            timestamp: '{timestamp}',
            details: '{details}',
          },
        ),
      };
    }
    return config;
  }

  private localizeDetails(
    details: Record<string, unknown> | string | undefined,
    locale: string,
  ): Record<string, unknown> | string | undefined {
    if (!details || typeof details !== 'object') return details;

    const connectionName = typeof details.connectionName === 'string' ? details.connectionName : null;
    if (details.testResult === 'success' && connectionName) {
      return {
        ...details,
        message: this.localizer.translate(
          locale,
          'notification.details.connectionTestSuccess',
          "Connection test successful for '{name}'!",
          { name: connectionName },
        ),
      };
    }

    const error = typeof details.error === 'string' ? details.error : null;
    if (details.testResult === 'failed' && connectionName && error) {
      return {
        ...details,
        message: this.localizer.translate(
          locale,
          'notification.details.connectionTestFailed',
          "Connection test failed for '{name}': {error}",
          { name: connectionName, error },
        ),
      };
    }

    const updatedKeys = Array.isArray(details.updatedKeys)
      ? details.updatedKeys.filter((key): key is string => typeof key === 'string')
      : null;
    if (updatedKeys) {
      const ipWhitelistUpdated = updatedKeys.includes('ipWhitelist');
      return {
        ...details,
        message: this.localizer.translate(
          locale,
          ipWhitelistUpdated ? 'notification.details.ipWhitelistUpdated' : 'notification.details.settingsUpdated',
          ipWhitelistUpdated ? 'IP Whitelist updated successfully.' : 'Settings updated successfully.',
        ),
      };
    }

    return details;
  }

  private testDetailsMessage(channelType: NotificationChannelType, locale: string, eventDisplay: string): string {
    if (channelType === 'webhook') {
      return this.localizer.translate(
        locale,
        'testNotification.webhook.detailsMessage',
        'This is a test notification from Nexus Terminal (webhook).',
        { event: eventDisplay, eventDisplay },
      );
    }
    if (channelType === 'telegram') {
      return this.localizer.translate(
        locale,
        'testNotification.telegram.detailsMessage',
        'This is a test notification from Nexus Terminal (Telegram).',
        { event: eventDisplay, eventDisplay },
      );
    }
    return this.localizer.translate(
      locale,
      'testNotification.email.detailsMessage',
      'This is a test notification from Nexus Terminal (Email).',
      { event: eventDisplay, eventDisplay },
    );
  }
}
