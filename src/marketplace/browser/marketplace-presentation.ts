import rcompare from 'semver/functions/rcompare.js';
import type { PluginManifest } from '../../plugin/plugin-manifest-types.js';
import type { MarketplaceCatalogPlugin } from '../marketplace-catalog-types.js';

function languageTag(value: string): string | undefined {
	try {
		return new Intl.Locale(value).baseName.toLowerCase();
	} catch {
		return undefined;
	}
}

export function marketplaceDescription(pack: PluginManifest, locale: string): string | undefined {
	const descriptions = new Map(
		Object.entries(pack.nexus.i18n ?? {}).map(([tag, { description }]) => [languageTag(tag), description.trim()]),
	);
	let tag = languageTag(locale);
	while (tag) {
		const description = descriptions.get(tag);
		if (description) return description;
		const parent = tag.lastIndexOf('-');
		tag = parent < 0 ? undefined : tag.slice(0, parent);
	}
	return pack.description?.trim() || undefined;
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
