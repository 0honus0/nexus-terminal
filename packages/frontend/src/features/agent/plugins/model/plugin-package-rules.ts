import type { PluginInstallation, PluginManifest, PluginPackageInstallation, PluginVersion } from './plugin-types';

export function installedPluginRequirements(
	installations: readonly PluginPackageInstallation[],
	versions: readonly PluginVersion[],
): PluginManifest['dependencies'] {
	const hashes = new Set(installations.filter((item) => item.status !== 'removed').map((item) => item.packageHash));
	return versions
		.filter((version) => hashes.has(version.packageHash))
		.flatMap((version) => version.manifest.dependencies);
}

export function isPluginPackageReferenced(
	installation: PluginPackageInstallation,
	apps: readonly PluginInstallation[],
	requirements: PluginManifest['dependencies'],
): boolean {
	return (
		apps.some(
			(item) =>
				item.status !== 'removed' &&
				item.definitionId === installation.packageId &&
				item.publisherKeyId === installation.publisherKeyId,
		) ||
		requirements.some(
			(item) => item.packageId === installation.packageId && item.publisherKeyId === installation.publisherKeyId,
		)
	);
}
