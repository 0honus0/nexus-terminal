import rcompare from 'semver/functions/rcompare.js';
import type { UiBadgeProps } from '../../ui/browser/ui-component-types.js';
import type { PluginManifest } from '../../plugin/plugin-manifest-types.js';
import type { MarketplacePlugin } from '../marketplace-types.js';
import type { MarketplaceCatalogPlugin } from '../marketplace-catalog-types.js';

function parseLocale(value: string): Intl.Locale | undefined {
	try {
		return new Intl.Locale(value);
	} catch {
		return undefined;
	}
}

function localizedText(
	locale: string,
	entries: readonly (readonly [string, string | undefined])[],
): string | undefined {
	const language = parseLocale(locale);
	if (!language) return;

	const translations = new Map(entries.map(([tag, text]) => [parseLocale(tag)?.baseName, text?.trim()]));
	let tag = language.baseName;
	while (tag) {
		const text = translations.get(tag);
		if (text) return text;
		const parent = tag.lastIndexOf('-');
		tag = parent < 0 ? '' : tag.slice(0, parent);
	}

	// 只有语言或文字系统时，使用 Intl 推导区域，例如 zh 对应 zh-CN。
	if (!language.region) {
		const preferred = language.maximize().baseName;
		for (const [candidate, text] of translations) {
			if (text && candidate && parseLocale(candidate)?.maximize().baseName === preferred) return text;
		}
	}
}

export function marketplaceDescription(pack: PluginManifest, locale: string): string | undefined {
	return (
		localizedText(
			locale,
			Object.entries(pack.nexus.i18n ?? {}).map(([tag, { description }]) => [tag, description]),
		) ??
		(pack.description?.trim() || undefined)
	);
}

export function marketplacePackageName(pack: PluginManifest, locale: string): string {
	return (
		localizedText(
			locale,
			Object.entries(pack.nexus.i18n ?? {}).map(([tag, { displayName }]) => [tag, displayName]),
		) ??
		pack.displayName ??
		marketplaceLabel(pack.name)
	);
}

export function marketplaceInstalledName(item: MarketplacePlugin, locale: string, contribution?: string): string {
	return (
		localizedText(locale, Object.entries(item.localizedNames ?? {})) ??
		item.displayName ??
		(item.localizedNames ? undefined : contribution) ??
		marketplaceLabel(item.pluginId)
	);
}

export function marketplaceLabel(id: string): string {
	return id
		.split('/')
		.at(-1)!
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

export function sortMarketplacePlugins(plugins: readonly MarketplaceCatalogPlugin[]): MarketplaceCatalogPlugin[] {
	return plugins.map(({ id, versions }) => ({
		id,
		versions: [...versions].sort((a, b) => rcompare(a.package.version, b.package.version)),
	}));
}

export type MarketplaceInstalledStatus =
	'available' | 'starting' | 'stopping' | 'configuration' | 'blocked' | 'disabled' | 'unavailable' | 'failed';

export const marketplaceStatusTones = {
	available: 'success',
	starting: 'primary',
	stopping: 'primary',
	configuration: 'warning',
	blocked: 'warning',
	disabled: 'neutral',
	unavailable: 'warning',
	failed: 'danger',
} satisfies Record<MarketplaceInstalledStatus, UiBadgeProps['tone']>;

export function marketplaceInstalledStatus({
	enabled,
	hasBackend,
	issue,
	runtime,
}: MarketplacePlugin): MarketplaceInstalledStatus {
	if (runtime?.runtime === 'stopping') return 'stopping';
	if (issue || runtime?.runtime === 'failed') return 'failed';
	if (!enabled) return 'disabled';
	if (runtime?.issues.some(({ code }) => code.startsWith('PLUGIN_DEPENDENCY_'))) return 'blocked';
	if (runtime?.runtime === 'running') {
		if (runtime.readiness.state === 'ready') return 'available';
		return runtime.readiness.reason ? 'configuration' : 'starting';
	}
	if (runtime?.runtime === 'starting') return 'starting';
	if (hasBackend === false) return 'available';
	return 'unavailable';
}
