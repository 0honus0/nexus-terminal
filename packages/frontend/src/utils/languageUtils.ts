import zhCN from '../locales/zh-CN.json';
import enUS from '../locales/en-US.json';
import jaJP from '../locales/ja-JP.json';

const languages = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'ja-JP': jaJP,
};

interface TranslationMap {
  [key: string]: string | TranslationMap;
}

type TranslationNode = string | TranslationMap;

export function getTranslation(key: string, locale: string = 'zh-CN'): string {
  const keys = key.split('.');
  const localeDict =
    (languages[locale as keyof typeof languages] as TranslationNode | undefined) ||
    languages['zh-CN'];
  let current: TranslationNode | undefined = localeDict;

  for (const k of keys) {
    if (!current || typeof current !== 'object' || !(k in current)) {
      return key;
    }
    current = (current as TranslationMap)[k];
    if (!current) return key;
  }

  return typeof current === 'string' ? current : key;
}
