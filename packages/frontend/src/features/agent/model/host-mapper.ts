import type { AppDefinition, ManagedApp } from './app-management-types';
import type { PluginInstallation, PluginVersion } from './plugin-types';
import type { HostApp, HostDirectory } from './host-types';

export function toHostDirectory(
	apps: ManagedApp[],
	definitions: AppDefinition[],
	installations: PluginInstallation[],
	versions: PluginVersion[],
	executionEnabled: boolean,
): HostDirectory {
	return {
		executionEnabled,
		apps: apps.map((app): HostApp => {
			const installation = installations.find((item) => item.appId === app.id);
			const executable =
				installation?.status === 'installed' &&
				installation.definitionId === app.definitionId &&
				installation.version === app.definitionVersion;
			const version = executable
				? versions.find(
						(item) =>
							item.packageHash === installation.packageHash &&
							item.publisherKeyId === installation.publisherKeyId &&
							item.manifest.id === app.definitionId &&
							item.manifest.version === app.definitionVersion,
					)
				: undefined;
			const declared = definitions.some(
				(item) => item.id === app.definitionId && item.version === app.definitionVersion,
			);
			let surface: HostApp['surface'] = 'unavailable';
			// /app-definitions is the trusted built-in catalogue, not the installed
			// plugin catalogue. A verified installed package has its own matching
			// manifest/publisher/hash identity and must not depend on a built-in
			// declaration to expose its authorized Agent or custom surface.
			if (declared && !installation) surface = 'agent';
			else if (version) surface = version.manifest.frontendEntry ? 'custom' : 'agent';
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
