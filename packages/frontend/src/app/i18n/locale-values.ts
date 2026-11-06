export const supportedLocales = ['en-US', 'zh-CN', 'ja-JP'] as const;

export type SupportedLocale = (typeof supportedLocales)[number];

export const defaultLocale: SupportedLocale = 'en-US';
