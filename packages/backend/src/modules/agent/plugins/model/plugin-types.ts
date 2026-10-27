import type { AgentPluginRuntimeState } from '@nexus-terminal/shared/agent/plugins/runtime-values';
import type { PluginIntentRpcInput, PluginIntentRpcResult } from './plugin-intent-types.js';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type {
	AgentPluginStageStatus,
	AgentPluginInstallationStatus,
} from '@nexus-terminal/shared/agent/plugins/values';

export interface PluginActor {
	userId: number;
	token: string;
}

export type DrainPluginRuns = (userId: number, appId: string) => Promise<void>;

export interface PluginVersion {
	manifest: PluginManifest;
	packageHash: string;
	publisherKeyId: string;
}

export interface PluginContent {
	bytes: Uint8Array;
	sha256: string;
}

export interface PluginFrontendDescriptor {
	appId: string;
	version: string;
	grant: string;
	entry: string;
	expiresAt: number;
}

export interface PluginPublisher {
	keyId: string;
	publicKeyPem: string;
	label: string;
	version: number;
	createdAt: number;
	revokedAt: number | null;
}

export interface PluginManifest {
	schemaVersion: 1;
	id: string;
	version: string;
	displayName: string;
	sdkVersion: '1';
	capabilities: AgentCapability[];
	intents: { id: string; schemaVersion: number }[];
	frontendEntry: string | null;
	backendEntry: string | null;
}

export interface PluginStage {
	id: string;
	packageHash: string;
	sizeBytes: number;
	status: AgentPluginStageStatus;
	version: number;
	publisherKeyId: string | null;
	manifest: PluginManifest | null;
	createdAt: number;
	updatedAt: number;
}

export interface PluginRecovery {
	userId: number;
	stage: PluginStage;
}

export interface PluginInstallation {
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

export interface PluginData {
	key: string;
	version: number;
	valueJson: string | null;
	updatedAt: number;
}

export interface PluginDataMutation {
	expectedRevision: number;
	expectedVersion: number;
	operationId: string;
	key: string;
	valueJson: string | null;
}

export type PluginRpcInput =
	| { method: 'host.appInfo' }
	| { method: 'storage.get'; key: string }
	| { method: 'storage.put'; key: string; expectedVersion: number; operationId: string; valueJson: string }
	| { method: 'storage.delete'; key: string; expectedVersion: number; operationId: string }
	| PluginIntentRpcInput;

export type PluginRpcResult =
	| { method: 'host.appInfo'; value: PluginInstallation }
	| { method: 'storage.get'; value: PluginData | null }
	| { method: 'storage.put' | 'storage.delete'; value: PluginData }
	| PluginIntentRpcResult;

export interface PluginDataPurge {
	revision: number;
	deletedKeys: number;
	updatedAt: number;
}

export interface PluginPackageSource {
	installation: PluginInstallation;
	manifest: PluginManifest;
	files: { path: string; bytes: Uint8Array; sha256: string }[];
}

export interface PluginRuntimeInstance {
	readonly exited: Promise<void>;

	activate(): Promise<void>;
	health(): Promise<boolean>;
	quiesce(deadline: number): Promise<void>;
	close(): Promise<void>;
}

export interface PluginRuntimeLease {
	userId: number;
	appId: string;
	instanceId: string;
	revision: number;
}

export interface PluginRuntimeOwner {
	instanceId: string;
	userId: number;
	appId: string;
	revision: number;
	instance: PluginRuntimeInstance | null;
	opening: Promise<PluginRuntimeInstance> | null;
	observation: Promise<void> | null;
	closePromise: Promise<void> | null;
	closing: boolean;
	stop: AbortController;
	pending: Set<Promise<unknown>>;
	failures: unknown[];
}

export interface PluginRepositorySettings {
	version: number;
	repositories: { url: string }[];
	updatedAt: number;
}

export interface PluginCatalogEntry {
	appId: string;
	version: string;
	sdkVersion: string;
	nexus: { minVersion: string; maxVersion: string };
	displayName: string;
	description: string;
	packageUrl: string;
	sha256: string;
	sizeBytes: number;
	publisherKeyId: string;
	compatible: boolean;
}

export interface PluginCatalog {
	repositoryUrl: string;
	publishers: { keyId: string; label: string; publicKeyPem: string }[];
	packages: PluginCatalogEntry[];
}

export interface PluginCatalogStage {
	repositoryUrl: string;
	appId: string;
	version: string;
}

export interface PluginRecommended {
	entry: PluginCatalogEntry | null;
	installation: PluginInstallation | null;
}

export interface PluginRuntimeObservation {
	appId: string;
	instanceId: string;
	revision: number;
	state: AgentPluginRuntimeState;
	updatedAt: number;
	unknownAt: number | null;
	acknowledgedAt: number | null;
}

export interface PluginRuntimeAcknowledgement {
	expectedRevision: number;
	instanceRevision: number;
	instanceId: string;
	confirmed: true;
}
