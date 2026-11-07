import semver from 'semver';

/** A signed selector resolves through its signed publisher and inclusive version range. */
export function matchesAppExecutionDependency(
	dependency: { publisherKeyId: string; minVersion: string; maxVersion: string },
	selected: { publisherKeyId: string; version: string },
): boolean {
	return (
		dependency.publisherKeyId === selected.publisherKeyId &&
		semver.satisfies(selected.version, '>=' + dependency.minVersion + ' <=' + dependency.maxVersion)
	);
}

/** Referencing an execution App does not adopt that App's own UI. */
export function isPluginAppUiContribution(
	rootPackageId: string,
	selected: { id: string; contributions: { app: object | null; ui: boolean } },
): boolean {
	return selected.contributions.ui && (selected.id === rootPackageId || selected.contributions.app === null);
}
