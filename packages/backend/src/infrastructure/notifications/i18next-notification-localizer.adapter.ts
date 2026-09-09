import fs from 'node:fs';
import path from 'node:path';
import i18next, { type i18n, type Resource } from 'i18next';
import type {
  NotificationLocalizer,
  NotificationTranslationValues,
} from '../../modules/notifications/notification-localizer.port';

export class I18nextNotificationLocalizer implements NotificationLocalizer {
  readonly defaultLocale = 'en-US';
  private readonly supportedLocales: Set<string>;
  private readonly instance: i18n;

  constructor(localesDirectory = path.resolve(__dirname, '../../locales')) {
    const resources: Resource = {};
    const locales = fs
      .readdirSync(localesDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .sort();

    if (!locales.includes(this.defaultLocale)) locales.push(this.defaultLocale);
    this.supportedLocales = new Set(locales);

    for (const locale of locales) {
      const localePath = path.join(localesDirectory, `${locale}.json`);
      if (!fs.existsSync(localePath)) continue;
      resources[locale] = {
        translation: JSON.parse(fs.readFileSync(localePath, 'utf8')) as Record<string, unknown>,
      };
    }

    this.instance = i18next.createInstance();
    void this.instance.init({
      resources,
      lng: this.defaultLocale,
      fallbackLng: this.defaultLocale,
      supportedLngs: locales,
      initAsync: false,
      interpolation: {
        escapeValue: false,
        prefix: '{',
        suffix: '}',
      },
    });
  }

  resolveLocale(locale: string | null | undefined): string {
    return locale && this.supportedLocales.has(locale) ? locale : this.defaultLocale;
  }

  translate(locale: string, key: string, defaultValue: string, values: NotificationTranslationValues = {}): string {
    return this.instance.t(key, {
      lng: this.resolveLocale(locale),
      defaultValue,
      ...values,
    });
  }
}
