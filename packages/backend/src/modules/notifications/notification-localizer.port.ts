export type NotificationTranslationValues = Record<string, string | number>;

export interface NotificationLocalizer {
  readonly defaultLocale: string;
  resolveLocale(locale: string | null | undefined): string;
  translate(locale: string, key: string, defaultValue: string, values?: NotificationTranslationValues): string;
}
