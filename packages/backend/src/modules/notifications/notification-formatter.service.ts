import type { NotificationLocalizer } from './notification-localizer.port';
import type { NotificationPayload, NotificationSetting, PreparedNotification } from './notification.types';

const interpolate = (template: string, data: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, key) => data[key] ?? match);

export class NotificationFormatter {
  constructor(private readonly localizer: NotificationLocalizer) {}

  prepare(
    setting: NotificationSetting,
    payload: NotificationPayload,
    timezone = 'UTC',
    locale = this.localizer.defaultLocale,
  ): PreparedNotification {
    const resolvedLocale = this.localizer.resolveLocale(locale);
    const eventDisplay = this.localizer.translate(resolvedLocale, `event.${payload.event}`, payload.event);
    const timestamp = this.formatTimestamp(payload.timestamp, timezone);
    const details =
      typeof payload.details === 'string' ? payload.details : JSON.stringify(payload.details ?? {}, null, 2);
    const data: Record<string, string> = {
      event: payload.event,
      eventDisplay,
      timestamp,
      details,
    };
    if (payload.details && typeof payload.details === 'object')
      for (const [key, value] of Object.entries(payload.details))
        if (value !== null && value !== undefined && typeof value !== 'object') data[key] = String(value);

    if (setting.channelType === 'email') {
      const config = setting.config as import('./notification.types').EmailConfig;
      const template =
        config.bodyTemplate ??
        this.localizer.translate(
          resolvedLocale,
          'notification.email.defaultBody',
          'Event: {eventDisplay}\nTimestamp: {timestamp}\nDetails:\n{details}',
          { eventDisplay: '{eventDisplay}', timestamp: '{timestamp}', details: '{details}' },
        );
      return {
        channelType: 'email',
        config,
        subject: eventDisplay,
        body: interpolate(template, data),
        payload,
      };
    }

    if (setting.channelType === 'telegram') {
      const config = setting.config as import('./notification.types').TelegramConfig;
      const template =
        config.messageTemplate ??
        this.localizer.translate(
          resolvedLocale,
          'notification.telegram.defaultBody',
          '*{eventDisplay}*\nTimestamp: {timestamp}\nDetails:\n```\n{details}\n```',
          { eventDisplay: '{eventDisplay}', timestamp: '{timestamp}', details: '{details}' },
        );
      return {
        channelType: 'telegram',
        config,
        body: interpolate(template, data),
        payload,
      };
    }

    const config = setting.config as import('./notification.types').WebhookConfig;
    const fallback = JSON.stringify(
      { event: payload.event, timestamp: new Date(payload.timestamp).toISOString(), details: payload.details ?? {} },
      null,
      2,
    );
    return {
      channelType: 'webhook',
      config,
      body: config.bodyTemplate ? interpolate(config.bodyTemplate, data) : fallback,
      payload,
    };
  }

  private formatTimestamp(timestamp: number, timezone: string): string {
    try {
      return new Intl.DateTimeFormat('sv-SE', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(timestamp));
    } catch {
      return new Date(timestamp).toISOString();
    }
  }
}
