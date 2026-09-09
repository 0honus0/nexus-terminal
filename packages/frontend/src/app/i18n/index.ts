import { createI18n, type Composer } from 'vue-i18n';

interface MessageTree {
  [key: string]: string | MessageTree;
}

export const supportedLocales = ['en-US', 'zh-CN', 'ja-JP'] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

const defaultLocale: SupportedLocale = 'en-US';
const localeStorageKey = 'user-locale';

const messageModules = {
  ...import.meta.glob<MessageTree>('./messages/*.json', { eager: true, import: 'default' }),
  ...import.meta.glob<MessageTree>('../pages/*/i18n/*.json', { eager: true, import: 'default' }),
  ...import.meta.glob<MessageTree>('../../shared/*/i18n/*.json', { eager: true, import: 'default' }),
  ...import.meta.glob<MessageTree>('../../features/*/i18n/*.json', { eager: true, import: 'default' }),
  ...import.meta.glob<MessageTree>('../../runtimes/*/i18n/*.json', { eager: true, import: 'default' }),
};

const isMessageTree = (value: string | MessageTree | undefined): value is MessageTree =>
  typeof value === 'object' && value !== null;

const mergeTree = (target: MessageTree, source: MessageTree, sourcePath: string, prefix = ''): void => {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const existing = target[key];

    if (typeof value === 'string') {
      if (existing !== undefined) {
        throw new Error(`[i18n] Duplicate translation key "${path}" from ${sourcePath}.`);
      }
      target[key] = value;
      continue;
    }

    if (typeof existing === 'string') {
      throw new Error(`[i18n] Translation namespace collision at "${path}" from ${sourcePath}.`);
    }

    const branch = isMessageTree(existing) ? existing : {};
    target[key] = branch;
    mergeTree(branch, value, sourcePath, path);
  }
};

const messages = Object.fromEntries(supportedLocales.map((locale) => [locale, {} as MessageTree])) as Record<
  SupportedLocale,
  MessageTree
>;

for (const [path, module] of Object.entries(messageModules)) {
  const locale = supportedLocales.find((candidate) => path.endsWith(`/${candidate}.json`));
  if (!locale) {
    throw new Error(`[i18n] Unsupported locale file: ${path}`);
  }
  mergeTree(messages[locale], module, path);
}

const flattenKeys = (tree: MessageTree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : flattenKeys(value, path);
  });

const referenceKeys = new Set(flattenKeys(messages[defaultLocale]));
for (const locale of supportedLocales) {
  const localeKeys = new Set(flattenKeys(messages[locale]));
  const missing = [...referenceKeys].filter((key) => !localeKeys.has(key));
  const extra = [...localeKeys].filter((key) => !referenceKeys.has(key));
  if (missing.length || extra.length) {
    throw new Error(
      `[i18n] Locale ${locale} does not match ${defaultLocale}. Missing: ${missing.join(', ') || '-'}; extra: ${extra.join(', ') || '-'}.`,
    );
  }
}

const resolveSupportedLocale = (candidate?: string | null): SupportedLocale | null => {
  if (!candidate) return null;
  if (supportedLocales.includes(candidate as SupportedLocale)) return candidate as SupportedLocale;

  const languageFallbacks: Record<string, SupportedLocale> = {
    en: 'en-US',
    zh: 'zh-CN',
    ja: 'ja-JP',
  };
  return languageFallbacks[candidate.split('-')[0] ?? ''] ?? null;
};

const getInitialLocale = (): SupportedLocale => {
  try {
    const stored = resolveSupportedLocale(localStorage.getItem(localeStorageKey));
    if (stored) return stored;
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }

  return resolveSupportedLocale(navigator.language) ?? defaultLocale;
};

const i18n = createI18n({
  legacy: false,
  locale: getInitialLocale(),
  fallbackLocale: defaultLocale,
  messages,
});

export const setLocale = (candidate: string): boolean => {
  const locale = resolveSupportedLocale(candidate);
  if (!locale) return false;

  const composer = i18n.global as unknown as Composer;
  composer.locale.value = locale;
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(localeStorageKey, locale);
  } catch {
    // Locale still changes for the current page when persistence is unavailable.
  }
  return true;
};

export const getLocale = (): SupportedLocale => {
  const composer = i18n.global as unknown as Composer;
  return resolveSupportedLocale(composer.locale.value) ?? defaultLocale;
};

export default i18n;
