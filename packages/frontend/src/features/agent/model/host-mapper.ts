import type { ManagedApp } from './app-management-types';
import type { PluginInstallation, PluginVersion, PluginAppBinding } from '../plugins/model/plugin-types';
import type { HostApp, HostDirectory } from './host-types';

export function toHostDirectory(
	apps: ManagedApp[],
	installations: PluginInstallation[],
	versions: PluginVersion[],
	executionEnabled: boolean,
	bindings: PluginAppBinding[],
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
			const binding = bindings.find((item) => item.appId === app.id);
			const bindingMatchesApp =
				binding?.app.packageId === app.definitionId &&
				binding.app.version === app.definitionVersion &&
				binding.app.packageHash === installation?.packageHash &&
				binding.app.publisherKeyId === installation?.publisherKeyId;
			const ui = binding?.ui;
			const uiVersion = ui
				? versionsByIdentity.get(JSON.stringify([ui.packageId, ui.version, ui.packageHash, ui.publisherKeyId]))
				: undefined;
			const surface: HostApp['surface'] =
				version &&
				bindingMatchesApp &&
				uiVersion?.manifest.frontendEntry &&
				uiVersion.manifest.contributionKinds.includes('ui')
					? 'plugin'
					: 'unavailable';
			return {
				id: app.id,
				displayName: app.name,
				definitionId: app.definitionId,
				version: app.version,
				packageVersion: binding?.ui?.version ?? app.definitionVersion,
				uiRevision: binding?.uiRevision ?? 0,
				enabled: app.enabled,
				executionState: app.executionState,
				surface,
			};
		}),
	};
}
