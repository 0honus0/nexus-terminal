import type { PluginManifest, PluginPublisher, PluginAppInitialization } from './plugin-types.js';

export interface PluginPackageReference {
	packageId: string;
	version: string;
	packageHash: string;
	publisherKeyId: string;
}

export interface PluginPackageInstallation {
	package: PluginPackageReference;
	status: 'installed' | 'draining' | 'removed' | 'incompatible';
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface PluginAppBinding {
	appId: string;
	executionRevision: number;
	uiRevision: number;
	app: PluginPackageReference;
	dependencies: PluginPackageReference[];
	selectedRootIds: string[];
	ui: PluginPackageReference | null;
}

export interface PluginCompositionCandidate {
	installation: PluginPackageInstallation;
	manifest: PluginManifest;
	publisher: PluginPublisher | null;
}

export interface PluginCompositionDecision {
	app: PluginPackageReference;
	dependencies: PluginPackageReference[];
	selectedRootIds: string[];
	ui: PluginPackageReference | null;
	initialization: PluginAppInitialization;
}

export interface PluginPackageUpdateDependency {
	package: PluginPackageReference;
	installationRevision: number;
}

export interface PluginPackageUpdatePreparation {
	installation: PluginPackageInstallation;
	dependencies: PluginPackageUpdateDependency[];
}

export interface PluginPackageUpdateDecision {
	uiOnly: boolean;
	impacts: PluginPackageUpdateImpact[];
	bindings: PluginAppBinding[];
	dependencies: PluginPackageUpdateDependency[];
}

export interface PluginPackageUpdateImpact {
	appId: string;
	restartApp: boolean;
	packageIds: string[];
}

export interface PluginPackageUpdateFacts {
	candidates: PluginCompositionCandidate[];
	current: PluginPackageInstallation;
	previousManifest: PluginManifest;
	stage: import('./plugin-types.js').PluginStage;
	publisher: PluginPublisher | null;
	references: { binding: PluginAppBinding; manifest: PluginManifest }[];
}

export interface PluginAppBindingUpdate {
	appId: string;
	before: { executionRevision: number; uiRevision: number };
	after: { executionRevision: number; uiRevision: number };
}

export interface PluginPackageUpdateResult {
	bindingUpdates: PluginAppBindingUpdate[];
	dependencies: PluginPackageUpdateDependency[];
	installation: PluginPackageInstallation;
	uiOnly: boolean;
	appIds: string[];
	impacts: PluginPackageUpdateImpact[];
}
