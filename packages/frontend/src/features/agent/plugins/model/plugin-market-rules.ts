import { compare, prerelease, satisfies } from 'semver';
import type { PluginCatalogEntry, PluginManifest } from './plugin-types';

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

export function recommendedCatalogEntries(
	entries: PluginCatalogEntry[],
	requirements: Dependency[],
): PluginCatalogEntry[] {
	const groups = new Map<string, PluginCatalogEntry[]>();
	for (const entry of entries) {
		const key = JSON.stringify([entry.publisherKeyId, entry.definitionId]);
		const versions = groups.get(key) ?? [];
		versions.push(entry);
		groups.set(key, versions);
	}
	return [...groups.values()].flatMap((versions) => {
		const sorted = versions.toSorted((left, right) => compare(right.version, left.version));
		const candidate =
			sorted.find(
				(entry) =>
					entry.compatible &&
					satisfiesAppRequirements(entry, requirements) &&
					prerelease(entry.version) === null,
			) ??
			sorted.find((entry) => prerelease(entry.version) === null) ??
			sorted[0];
		return candidate ? [candidate] : [];
	});
}
