import type { AgentPluginRuntimeState } from '@nexus-terminal/shared/agent/plugins/runtime-values';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { AgentPluginStageStatus } from '@nexus-terminal/shared/agent/plugins/values';
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

export interface StoredPluginManifest {
	schemaVersion: 1;
	id: string;
	version: string;
	displayName: string;
	sdkVersion: string;
	capabilities: AgentCapability[];
	intents: { id: string; schemaVersion: number }[];
	frontendEntry: string | null;
	backendEntry: string | null;
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

export interface PluginStorage {
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
		admitCapacity: (keys: number, bytes: number, retained: number) => void,
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
		admit: (
			current: StoredPluginInstallation,
			publisher: StoredPluginPublisher | null,
			enabled: boolean,
			retained: number,
		) => void,
	): Promise<void>;
	settleRuntime(input: StoredPluginRuntimeLease, state: 'active' | 'closed' | 'unknown'): Promise<void>;

	runtimeTargets(): Promise<{ userId: number; appId: string }[]>;
	runtimeContent(
		userId: number,
		appId: string,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
	): Promise<StoredPluginContentSource>;
	runtimeReadData(
		userId: number,
		appId: string,
		key: string,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
	): Promise<StoredPluginData | null>;
	runtimeMutateData(
		userId: number,
		appId: string,
		input: StoredPluginDataMutation,
		admit: (current: StoredPluginInstallation, publisher: StoredPluginPublisher | null, enabled: boolean) => void,
		decide: (
			current: StoredPluginData | null,
			keyCount: number,
			operationCount: number,
			dataBytes: number,
			operationBytes: number,
		) => void,
	): Promise<StoredPluginData>;

	purgeData(
		userId: number,
		digest: string,
		appId: string,
		revision: number,
		operationId: string,
		now: number,
		admit: (identity: number | null, current: StoredPluginInstallation) => void,
		decide: (currentRevision: number, purgeCount: number) => void,
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
		decide: (
			current: StoredPluginData | null,
			keyCount: number,
			operationCount: number,
			dataBytes: number,
			operationBytes: number,
		) => void,
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
	install(
		userId: number,
		digest: string,
		stageId: string,
		version: number,
		appId: string,
		now: number,
		admit: (
			identity: number | null,
			stage: StoredPluginStage,
			publisher: StoredPluginPublisher | null,
			current: StoredPluginInstallation | null,
		) => void,
	): Promise<StoredPluginInstallation>;
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
		admit: (identity: number | null, count: number) => void,
	): Promise<StoredPluginStage>;
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
	status: 'installed' | 'draining' | 'removed';
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface StoredPluginActivation {
	userId: number;
	appId: string;
	definitionId: string;
	definitionVersion: string;
	displayName: string;
	contentHash: string;
	capabilities: import('@nexus-terminal/shared/agent/governance/values').AgentCapability[];
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
