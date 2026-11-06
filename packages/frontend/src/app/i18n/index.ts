import { installUiTranslator } from '@/shared/i18n/public';
import { createI18n } from 'vue-i18n';
import { supportedLocales, defaultLocale, type SupportedLocale } from './locale-values';

export { supportedLocales, type SupportedLocale } from './locale-values';

import { readStoredValue, stringStorageCodec, writeStoredValue } from '@/foundation/browser';

const localeStorage = {
	namespace: 'locale',
	version: 1,
	codec: stringStorageCodec((value) => supportedLocales.includes(value as SupportedLocale)),
	legacyKeys: ['user-locale'],
} as const;

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
	const stored = resolveSupportedLocale(readStoredValue(localeStorage));
	if (stored) return stored;

	return resolveSupportedLocale(navigator.language) ?? defaultLocale;
};

const i18n = createI18n({
	legacy: false,
	locale: getInitialLocale(),
	fallbackLocale: defaultLocale,
	messages: {},
});

installUiTranslator((key, parameters) => (parameters ? i18n.global.t(key, parameters) : i18n.global.t(key)));

const loaders = {
	'en-US': () => import('virtual:nexus-locale/en-US'),

	'zh-CN': () => import('virtual:nexus-locale/zh-CN'),

	'ja-JP': () => import('virtual:nexus-locale/ja-JP'),
};
const loading = new Map<SupportedLocale, Promise<void>>();
let selection = 0;

function loadLocale(locale: SupportedLocale): Promise<void> {
	const previous = loading.get(locale);
	if (previous) return previous;
	const task = loaders[locale]()
		.then((module) => {
			i18n.global.setLocaleMessage(locale, module.default);
		})
		.catch((error: unknown) => {
			loading.delete(locale);
			throw error;
		});
	loading.set(locale, task);
	return task;
}

export async function initializeLocale(): Promise<void> {
	const locale = getInitialLocale();
	await loadLocale(locale);
	i18n.global.locale.value = locale;
	document.documentElement.lang = locale;
}

export async function setLocale(candidate: string): Promise<boolean> {
	const locale = resolveSupportedLocale(candidate);
	if (!locale) return false;
	const current = ++selection;
	await loadLocale(locale);
	if (current !== selection) return false;
	i18n.global.locale.value = locale;
	document.documentElement.lang = locale;
	writeStoredValue(localeStorage, locale);
	return true;
}

export const getLocale = (): SupportedLocale => resolveSupportedLocale(i18n.global.locale.value) ?? defaultLocale;

export default i18n;
