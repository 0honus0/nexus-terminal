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
