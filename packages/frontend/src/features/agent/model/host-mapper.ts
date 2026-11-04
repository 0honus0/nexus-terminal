import type { ManagedApp } from './app-management-types';
import type { PluginInstallation, PluginVersion } from './plugin-types';
import type { HostApp, HostDirectory } from './host-types';

export function toHostDirectory(
	apps: ManagedApp[],
	installations: PluginInstallation[],
	versions: PluginVersion[],
	executionEnabled: boolean,
): HostDirectory {
	const installationsByApp = new Map(installations.map((installation) => [installation.appId, installation]));
	const versionsByIdentity = new Map<string, PluginVersion>();
	for (const version of versions) {
		const key = JSON.stringify([
			version.manifest.id,
			version.manifest.version,
			version.packageHash,
			version.publisherKeyId,
		]);
		if (!versionsByIdentity.has(key)) versionsByIdentity.set(key, version);
	}
	return {
		executionEnabled,
		apps: apps.map((app): HostApp => {
			const installation = installationsByApp.get(app.id);
			const executable =
				installation?.status === 'installed' &&
				installation.definitionId === app.definitionId &&
				installation.version === app.definitionVersion;
			const version = executable
				? versionsByIdentity.get(
						JSON.stringify([
							app.definitionId,
							app.definitionVersion,
							installation.packageHash,
							installation.publisherKeyId,
						]),
					)
				: undefined;
			const surface: HostApp['surface'] = version
				? version.manifest.frontendEntry
					? 'custom'
					: 'agent'
				: 'unavailable';
			return {
				id: app.id,
				displayName: app.name,
				definitionId: app.definitionId,
				version: app.version,
				packageVersion: app.definitionVersion,
				enabled: app.enabled,
				executionState: app.executionState,
				surface,
			};
		}),
	};
}
