import { compare, prerelease, satisfies } from 'semver';
import type { PluginCatalogEntry, PluginManifest, PluginPackageInstallation } from './plugin-types';
import type { PluginCatalogGroup, PluginCatalogOption, PluginCatalogSource } from './plugin-market-types';

/** Merge presentation by package ID while retaining the exact source, signer and archive of every choice. */
export function mergePluginCatalogs(
	sources: PluginCatalogSource[],
	installations: PluginPackageInstallation[],
	requirements: Dependency[],
	selections: ReadonlyMap<string, string>,
): PluginCatalogGroup[] {
	const groups = new Map<string, PluginCatalogOption[]>();
	for (const { source, catalog } of sources) {
		for (const entry of catalog.packages) {
			const options = groups.get(entry.definitionId) ?? [];
			options.push({
				source,
				catalog,
				entry,
				key: JSON.stringify([source, entry.publisherKeyId, entry.definitionId, entry.version, entry.sha256]),
			});
			groups.set(entry.definitionId, options);
		}
	}
	return [...groups].flatMap(([id, entries]) => {
		const options = entries.toSorted((left, right) => compare(right.entry.version, left.entry.version));
		const installation = installations.find((item) => item.packageId === id && item.status !== 'removed');
		const samePublisher = options.filter((item) => item.entry.publisherKeyId === installation?.publisherKeyId);
		const preferred = samePublisher.length ? samePublisher : options;
		const eligible = preferred.filter(
			(item) =>
				item.entry.compatible &&
				satisfiesAppRequirements(item.entry, requirements) &&
				prerelease(item.entry.version) === null,
		);
		const candidates = eligible.length ? eligible : preferred;
		const explicit = options.find((item) => item.key === selections.get(id));
		const preferredSource = sources.find((source) => candidates.some((item) => item.source === source.source));
		const selected =
			explicit ?? candidates.find((item) => item.source === preferredSource?.source) ?? candidates[0];
		return selected
			? [{ id, options, selected, needsVersionChoice: !explicit && prerelease(selected.entry.version) !== null }]
			: [];
	});
}

/** A candidate older than the installed version never represents an upgrade. */
export function isPluginUpgrade(installedVersion: string, candidateVersion: string): boolean {
	return compare(candidateVersion, installedVersion) > 0;
}

/** Publisher identity is part of a package identity, including within one source. */
type Dependency = PluginManifest['dependencies'][number];

export function satisfiesAppRequirements(entry: PluginCatalogEntry, requirements: Dependency[]): boolean {
	return requirements.every(
		(requirement) =>
			requirement.packageId !== entry.definitionId ||
			requirement.publisherKeyId !== entry.publisherKeyId ||
			satisfies(entry.version, '>=' + requirement.minVersion + ' <=' + requirement.maxVersion),
	);
}

/** Catalog translations are publisher data; use the original text when no language matches. */
export function localizeCatalogEntry(
	entry: PluginCatalogEntry,
	locale: string,
): { displayName: string; description: string } {
	const language = new Intl.Locale(locale).language;
	const translation =
		entry.localizations?.find((item) => item.locale === locale) ??
		entry.localizations?.find((item) => item.locale === language) ??
		entry.localizations?.find((item) => new Intl.Locale(item.locale).language === language);
	return {
		displayName: translation?.displayName ?? entry.displayName,
		description: translation?.description ?? entry.description,
	};
}
