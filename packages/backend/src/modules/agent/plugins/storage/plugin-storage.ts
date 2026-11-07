import type { StoredPluginSignedContribution, StoredPluginPackageDependency } from './plugin-manifest-storage.js';
import type { PluginCompositionStorage as importCompositionStorage } from './plugin-composition-storage.js';
import type { AgentPluginRuntimeState } from '@nexus-terminal/shared/agent/plugins/runtime-values';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type {
	AgentPluginStageStatus,
	AgentPluginInstallationStatus,
} from '@nexus-terminal/shared/agent/plugins/values';
import type {
	StoredPluginDataSnapshot,
	StoredPluginDataMigration,
	StoredPluginDataMigrationResult,
} from './plugin-migration-storage.js';

export interface StoredPluginPublisher {
	keyId: string;
	publicKeyPem: string;
	label: string;
	version: number;
	createdAt: number;
	revokedAt: number | null;
}

export interface StoredPluginAppInitialization {
	enabled: boolean;
	grantedCapabilities: AgentCapability[] | null;
}

export interface StoredPluginManifest {
	schemaVersion: 4;
	id: string;
	version: string;
	displayName: string;
	compatibility: {
		host: { minVersion: string; maxVersion: string };
		backendSdk: number | null;
		frontendSdk: number | null;
	};
	contributions: StoredPluginSignedContribution;
	capabilities: AgentCapability[];
	intents: { id: string; schemaVersion: number }[];
	frontendEntry: string | null;
	backendEntry: string | null;
	dependencies: StoredPluginPackageDependency[];
	namespaces: string[];
}

export interface StoredPluginStage {
	id: string;
	packageHash: string;
	sizeBytes: number;
	status: AgentPluginStageStatus;
	version: number;
	publisherKeyId: string | null;
	manifest: StoredPluginManifest | null;
	createdAt: number;
	updatedAt: number;
}

export interface StoredPluginRecovery {
	userId: number;
	stage: StoredPluginStage;
}

export interface StoredPluginRuntimeLease {
	logicalInstanceId: string;
	generation: string;
	configurationRevision: number;
	packageId: string;
	userId: number;
	appId: string;
	instanceId: string;
	revision: number;
	now: number;
}

export interface StoredPluginRuntimeObservation {
	appId: string;
	instanceId: string;
	revision: number;
	state: AgentPluginRuntimeState;
	updatedAt: number;
	unknownAt: number | null;
	acknowledgedAt: number | null;
}

export interface PluginStorage extends importCompositionStorage {
	dataSnapshot(
		userId: number,
		digest: string,
		appId: string,
		admit: (
			identity: number | null,
			installation: StoredPluginInstallation,
			runtimeClosed: boolean,
			upgradePending: boolean,
		) => void,
		namespace?: string,
	): Promise<StoredPluginDataSnapshot>;
	migrateData(
		userId: number,
		digest: string,
		appId: string,
		input: StoredPluginDataMigration,
		admit: (
			identity: number | null,
			installation: StoredPluginInstallation,
			runtimeClosed: boolean,
			upgradePending: boolean,
		) => void,
	): Promise<StoredPluginDataMigrationResult>;
	withFrontendAdmission<T>(
		userId: number,
		digest: string,
		appId: string,
		admit: (
			identity: number | null,
			current: StoredPluginInstallation,
			publisher: StoredPluginPublisher | null,
			enabled: boolean,
		) => void,
		work: () => Promise<T>,
	): Promise<T>;
	assertRuntimeClosed(userId: number, appId: string): Promise<void>;
	observeRuntime(
		userId: number,
		digest: string,
		appId: string,
		admit: (identity: number | null) => void,
		instanceId: string | null,
	): Promise<StoredPluginRuntimeObservation | null>;
	acknowledgeRuntime(
		userId: number,
		digest: string,
		appId: string,
		instanceId: string,
		instanceRevision: number,
		now: number,
		admit: (identity: number | null, installation: StoredPluginInstallation) => void,
	): Promise<StoredPluginRuntimeObservation>;

	recoverRuntimes(now: number): Promise<void>;
	reserveRuntime(
		input: StoredPluginRuntimeLease,
		historyLimit: number,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
	): Promise<void>;
	settleRuntime(input: StoredPluginRuntimeLease, state: 'active' | 'closed' | 'unknown'): Promise<void>;

	runtimeTargets(): Promise<{ userId: number; appId: string }[]>;
	runtimeContent(
		userId: number,
		appId: string,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
		packageId?: string,
	): Promise<StoredPluginContentSource>;
	runtimeReadData(
		userId: number,
		appId: string,
		key: string,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
		packageId?: string,
	): Promise<StoredPluginData | null>;
	runtimeMutateData(
		userId: number,
		appId: string,
		input: StoredPluginDataMutation,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
		decide: (current: StoredPluginData | null) => void,
		packageId?: string,
	): Promise<StoredPluginData>;

	purgeData(
		userId: number,
		digest: string,
		appId: string,
		revision: number,
		operationId: string,
		now: number,
		admit: (identity: number | null, current: StoredPluginInstallation) => void,
		decide: (currentRevision: number) => void,
	): Promise<StoredPluginDataPurge>;

	readData(
		userId: number,
		digest: string,
		appId: string,
		key: string,
		admit: (
			identity: number | null,
			current: StoredPluginInstallation,
			publisher: StoredPluginPublisher | null,
			enabled: boolean,
		) => void,
		packageId?: string,
	): Promise<StoredPluginData | null>;
	mutateData(
		userId: number,
		digest: string,
		appId: string,
		input: StoredPluginDataMutation,
		admit: (
			identity: number | null,
			current: StoredPluginInstallation,
			publisher: StoredPluginPublisher | null,
			enabled: boolean,
		) => void,
		decide: (current: StoredPluginData | null) => void,
		packageId?: string,
	): Promise<StoredPluginData>;

	versions(userId: number): Promise<StoredPluginVersion[]>;
	content(
		userId: number,
		digest: string,
		appId: string,
		version: string,
		admit: (
			identity: number | null,
			current: StoredPluginInstallation,
			publisher: StoredPluginPublisher | null,
			enabled: boolean,
		) => void,
		settingsInstanceId?: string,
	): Promise<StoredPluginContentSource>;
	beginRetirement(
		userId: number,
		digest: string,
		appId: string,
		revision: number,
		stageId: string | null,
		stageVersion: number | null,
		now: number,
		admit: (
			identity: number | null,
			current: StoredPluginInstallation,
			stage: StoredPluginStage | null,
			publisher: StoredPluginPublisher | null,
		) => void,
	): Promise<StoredPluginInstallation>;
	finishRemoval(
		userId: number,
		digest: string,
		appId: string,
		revision: number,
		now: number,
		admit: (identity: number | null) => void,
	): Promise<StoredPluginInstallation>;
	cancelRetirement(
		userId: number,
		digest: string,
		appId: string,
		revision: number,
		now: number,
		admit: (identity: number | null, publisher: StoredPluginPublisher | null, dataMigrated: boolean) => void,
	): Promise<StoredPluginInstallation>;
	installations(userId: number): Promise<StoredPluginInstallation[]>;
	installationDirectory(userId: number): Promise<StoredPluginInstallationDirectory>;
	stages(userId: number): Promise<StoredPluginStage[]>;
	recovery(): Promise<StoredPluginRecovery[]>;
	recoverStage(userId: number, id: string, version: number, status: 'staged' | 'failed', now: number): Promise<void>;
	publishers(userId: number): Promise<StoredPluginPublisher[]>;
	putPublisher(
		userId: number,
		digest: string,
		record: StoredPluginPublisher,
		admit: (identity: number | null, existing: StoredPluginPublisher | null, count: number) => void,
	): Promise<StoredPluginPublisher>;
	revokePublisher(
		userId: number,
		digest: string,
		keyId: string,
		version: number,
		now: number,
		admit: (identity: number | null) => void,
	): Promise<{ publisher: StoredPluginPublisher; appIds: string[] }>;
	createStage(
		userId: number,
		digest: string,
		record: StoredPluginStage,
		admit: (identity: number | null) => void,
	): Promise<StoredPluginStage>;
	reusableStage(
		userId: number,
		digest: string,
		packageHash: string,
		admit: (
			identity: number | null,
			current: StoredPluginStage | null,
			publisher: StoredPluginPublisher | null,
		) => void,
	): Promise<StoredPluginStage | null>;
	claimStageCleanup(
		userId: number,
		digest: string,
		retain: number,
		admit: (identity: number | null) => void,
	): Promise<StoredPluginStage[]>;
	finishStageCleanup(userId: number, id: string, version: number): Promise<void>;
	getStage(userId: number, id: string): Promise<StoredPluginStage | null>;
	updateStage(
		userId: number,
		digest: string,
		id: string,
		version: number,
		now: number,
		decide: (
			identity: number | null,
			current: StoredPluginStage,
			publishers: StoredPluginPublisher[],
		) => { status: AgentPluginStageStatus; manifest: StoredPluginManifest | null; publisherKeyId: string | null },
	): Promise<StoredPluginStage>;
}

export class PluginRuntimeFenceRefusal extends Error {
	constructor() {
		super('Plugin runtime is fenced');
		this.name = 'PluginRuntimeFenceRefusal';
	}
}

export class PluginStorageRefusal extends Error {
	constructor(readonly code: 'not_found' | 'version_conflict' | 'operation_unknown') {
		super(code);
	}
}

export interface StoredPluginInstallation {
	appId: string;
	definitionId: string;
	version: string;
	packageHash: string;
	publisherKeyId: string;
	status: AgentPluginInstallationStatus;
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface StoredPluginInstallationDirectory {
	installations: StoredPluginInstallation[];
	retainedAppIds: string[];
}

export interface StoredPluginExecutionPackage {
	packageId: string;
	kind: 'app' | 'tool';
	version: string;
	packageHash: string;
	publisherKeyId: string;
}

export interface StoredPluginActivation {
	mode: 'install' | 'selection' | 'provider';
	executionPackages: StoredPluginExecutionPackage[];
	userId: number;
	appId: string;
	definitionId: string;
	definitionVersion: string;
	displayName: string;
	contentHash: string;
	capabilities: import('@nexus-terminal/shared/agent/governance/values').AgentCapability[];
	enabled: boolean;
	grantedCapabilities: AgentCapability[] | null;
	now: number;
}

export interface StoredPluginVersion {
	manifest: StoredPluginManifest;
	packageHash: string;
	publisherKeyId: string;
}

export interface StoredPluginContentSource {
	installation: StoredPluginInstallation;
	stage: StoredPluginStage;
	publicKeyPem: string;
}

export interface StoredPluginData {
	key: string;
	version: number;
	valueJson: string | null;
	updatedAt: number;
}

export interface StoredPluginDataMutation {
	operationId: string;
	contentHash: string;
	key: string;
	valueJson: string | null;
	now: number;
}

export interface StoredPluginDataPurge {
	revision: number;
	deletedKeys: number;
	updatedAt: number;
}
