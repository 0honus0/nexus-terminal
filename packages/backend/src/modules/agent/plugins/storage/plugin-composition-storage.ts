import type {
	StoredPluginAppInitialization,
	StoredPluginManifest,
	StoredPluginPublisher,
	StoredPluginStage,
} from './plugin-storage.js';
import type { StoredPluginAppExecution } from './plugin-app-execution-storage.js';

export interface StoredPluginPackageReference {
	packageId: string;
	version: string;
	packageHash: string;
	publisherKeyId: string;
}

export interface StoredPluginPackageInstallation {
	package: StoredPluginPackageReference;
	status: 'installed' | 'draining' | 'removed' | 'incompatible';
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface StoredPluginAppBinding {
	appId: string;
	executionRevision: number;
	uiRevision: number;
	app: StoredPluginPackageReference;
	dependencies: StoredPluginPackageReference[];
	selectedRootIds: string[];
	ui: StoredPluginPackageReference | null;
}

export interface StoredPluginCompositionCandidate {
	installation: StoredPluginPackageInstallation;
	manifest: StoredPluginManifest;
	publisher: StoredPluginPublisher | null;
}

export interface PluginCompositionStorage {
	cancelPackageUpdate(
		userId: number,
		digest: string,
		packageId: string,
		revision: number,
		now: number,
		admit: (identity: number | null, current: StoredPluginPackageInstallation) => void,
	): Promise<StoredPluginPackageInstallation>;
	packageDirectory(
		userId: number,
	): Promise<{ installations: StoredPluginPackageInstallation[]; retainedPackageIds: string[] }>;
	appBindings(userId: number): Promise<StoredPluginAppBinding[]>;
	packageRetainedData(userId: number): Promise<string[]>;
	removePackage(
		userId: number,
		digest: string,
		packageId: string,
		revision: number,
		clearData: boolean,
		now: number,
		admit: (
			identity: number | null,
			current: StoredPluginPackageInstallation,
			referenced: boolean,
			runtimeClosed: boolean,
			updatePending: boolean,
		) => void,
	): Promise<StoredPluginPackageInstallation>;
	updatePackage(
		userId: number,
		digest: string,
		packageId: string,
		revision: number,
		stageId: string,
		stageVersion: number,
		now: number,
		phase: 'prepare' | 'commit',
		admit: (identity: number | null, facts: StoredPluginPackageUpdateFacts) => StoredPluginPackageUpdateDecision,
	): Promise<StoredPluginPackageUpdateResult>;

	packageInstallations(userId: number): Promise<StoredPluginPackageInstallation[]>;
	installPackage(
		userId: number,
		digest: string,
		stageId: string,
		stageVersion: number,
		now: number,
		admit: (
			identity: number | null,
			stage: StoredPluginStage,
			publisher: StoredPluginPublisher | null,
			current: StoredPluginPackageInstallation | null,
			updatePending: boolean,
		) => void,
	): Promise<StoredPluginPackageInstallation>;
	composeApp(
		userId: number,
		digest: string,
		appId: string,
		packageId: string,
		expectedBinding: { executionRevision: number; uiRevision: number } | null,
		now: number,
		admit: (
			identity: number | null,
			candidates: StoredPluginCompositionCandidate[],
		) => {
			app: StoredPluginPackageReference;
			dependencies: StoredPluginPackageReference[];
			selectedRootIds: string[];
			ui: StoredPluginPackageReference | null;
			initialization: StoredPluginAppInitialization;
		},
	): Promise<StoredPluginAppBinding>;
	appBinding(userId: number, appId: string): Promise<StoredPluginAppBinding>;
	appExecutionBinding(
		userId: number,
		appId: string,
		allowDraining: boolean,
	): Promise<StoredPluginAppExecution | null>;
}

export interface StoredPluginPackageUpdateDependency {
	package: StoredPluginPackageReference;
	installationRevision: number;
}

export interface StoredPluginPackageUpdateDecision {
	uiOnly: boolean;
	impacts: StoredPluginPackageUpdateImpact[];
	bindings: StoredPluginAppBinding[];
	dependencies: StoredPluginPackageUpdateDependency[];
}

export interface StoredPluginPackageUpdateImpact {
	appId: string;
	restartApp: boolean;
	packageIds: string[];
}

export interface StoredPluginPackageUpdateFacts {
	candidates: StoredPluginCompositionCandidate[];
	current: StoredPluginPackageInstallation;
	previousManifest: StoredPluginManifest;
	stage: StoredPluginStage;
	publisher: StoredPluginPublisher | null;
	references: { binding: StoredPluginAppBinding; manifest: StoredPluginManifest }[];
}

export interface StoredPluginPackageUpdateResult {
	bindingUpdates: {
		appId: string;
		before: { executionRevision: number; uiRevision: number };
		after: { executionRevision: number; uiRevision: number };
	}[];
	dependencies: StoredPluginPackageUpdateDependency[];
	installation: StoredPluginPackageInstallation;
	uiOnly: boolean;
	appIds: string[];
	impacts: StoredPluginPackageUpdateImpact[];
}
