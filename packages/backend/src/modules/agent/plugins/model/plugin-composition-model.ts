import type {
	PluginAppBinding,
	PluginPackageInstallation,
	PluginPackageReference,
} from './plugin-composition-types.js';
import type {
	StoredPluginAppBinding,
	StoredPluginPackageInstallation,
	StoredPluginPackageReference,
} from '../storage/plugin-composition-storage.js';

export function fromPluginPackageReference(value: StoredPluginPackageReference): PluginPackageReference {
	return {
		packageId: value.packageId,
		version: value.version,
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
	};
}

export function toPluginPackageReference(value: PluginPackageReference): StoredPluginPackageReference {
	return {
		packageId: value.packageId,
		version: value.version,
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
	};
}

export function fromPluginPackageInstallation(value: StoredPluginPackageInstallation): PluginPackageInstallation {
	return {
		package: fromPluginPackageReference(value.package),
		status: value.status,
		revision: value.revision,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function fromPluginAppBinding(value: StoredPluginAppBinding): PluginAppBinding {
	return {
		appId: value.appId,
		executionRevision: value.executionRevision,
		uiRevision: value.uiRevision,
		app: fromPluginPackageReference(value.app),
		dependencies: value.dependencies.map(fromPluginPackageReference),
		selectedRootIds: value.selectedRootIds.map((id) => id),
		ui: value.ui === null ? null : fromPluginPackageReference(value.ui),
	};
}
