import type { RegistryDefinition } from '../registry/model/registry-types.js';
import type { PluginCallableInput, PluginCapabilityReply, PluginCapabilityRequest } from './plugin-invocation-types.js';
import type { HostOperationResult } from '../../tools/model/host-operation-result.js';
import type { AgentPluginHostOperationName } from '@nexus-terminal/shared/agent/plugins/values';
import type { PluginSignedContribution, PluginPackageDependency } from './plugin-manifest-types.js';
import type { AgentPluginRuntimeState } from '@nexus-terminal/shared/agent/plugins/runtime-values';
import type { PluginIntentRpcInput, PluginIntentRpcResult } from './plugin-intent-types.js';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type {
	AgentPluginStageStatus,
	AgentPluginContributionKind,
	AgentPluginCompatibilityReason,
	AgentPluginInstallationStatus,
} from '@nexus-terminal/shared/agent/plugins/values';

export interface PluginActor {
	userId: number;
	token: string;
}

export type DrainPluginRuns = (userId: number, appId: string) => Promise<void>;

export interface PluginRuntimeRetirementScope {
	userId: number;
	appId: string;
	instanceId: string;
	generation: string;
}

export interface PluginAppInitialization {
	enabled: boolean;
	grantedCapabilities: AgentCapability[] | null;
}

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
	purpose: 'app' | 'settings';
	instanceId: string;
	package: import('./plugin-composition-types.js').PluginPackageReference;
	uiRevision: number;
	appId: string;
	version: string;
	grant: string;
	entry: string;
	expiresAt: number;
}

export type PluginFrontendGrant = {
	actor: PluginActor;
	appId: string;
	packageId: string;
	version: string;
	revision: number;
	expiresAt: number;
} & ({ purpose: 'app' } | { purpose: 'settings'; instanceId: string; schemaRevision: number });

export interface PluginPublisher {
	keyId: string;
	publicKeyPem: string;
	label: string;
	version: number;
	createdAt: number;
	revokedAt: number | null;
}

export interface PluginManifest {
	schemaVersion: 4;
	id: string;
	version: string;
	displayName: string;
	requiredOnEnable?: boolean;
	compatibility: {
		host: { minVersion: string; maxVersion: string };
		backendSdk: number | null;
		frontendSdk: number | null;
	};
	contributions: PluginSignedContribution;
	capabilities: AgentCapability[];
	intents: { id: string; schemaVersion: number }[];
	frontendEntry: string | null;
	backendEntry: string | null;
	dependencies: PluginPackageDependency[];
	namespaces: string[];
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

export interface PluginInstallationDirectory {
	installations: PluginInstallation[];
	retainedAppIds: string[];
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
	| { method: 'settings.read' }
	| { method: 'settings.write'; command: import('./plugin-instance-types.js').PluginConfigurationWrite }
	| { method: 'host.perform'; operation: AgentPluginHostOperationName; argumentsJson: string }
	| { method: 'host.appInfo' }
	| { method: 'storage.get'; key: string }
	| { method: 'storage.put'; key: string; expectedVersion: number; operationId: string; valueJson: string }
	| { method: 'storage.delete'; key: string; expectedVersion: number; operationId: string }
	| PluginIntentRpcInput;

export type PluginRpcResult =
	| { method: 'settings.read'; value: import('./plugin-instance-types.js').PluginInstanceSource }
	| { method: 'settings.write'; value: import('./plugin-instance-types.js').PluginConfiguration }
	| { method: 'host.perform'; value: HostOperationResult }
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
	activate(): Promise<RegistryDefinition[]>;
	releaseResources(runId: string, deadlineUnixMs: number): Promise<void>;
	invokeCallable(
		input: PluginCallableInput,
		signal: AbortSignal,
		timeoutMs: number,
		call: (input: PluginCapabilityRequest) => Promise<PluginCapabilityReply>,
	): Promise<string>;
	health(): Promise<boolean>;
	quiesce(deadline: number): Promise<void>;
	close(): Promise<void>;
}

export interface PluginRuntimeLease {
	generation: string;
	logicalInstanceId: string;
	configurationRevision: number;
	packageId: string;
	userId: number;
	appId: string;
	instanceId: string;
	revision: number;
}

export interface PluginRuntimeOwner {
	logicalInstanceId: string;
	configurationRevision: number;
	generation: string;
	withdrawRegistrations: (() => void) | null;
	runtimeKey: string;
	packageId: string;
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
	packageId: string;
	version: string;
	compatibility: {
		host: { minVersion: string; maxVersion: string };
		backendSdk: number | null;
		frontendSdk: number | null;
	};
	contributionKinds: AgentPluginContributionKind[];
	displayName: string;
	requiredOnEnable?: boolean;
	description: string;
	localizations?: { locale: string; displayName: string; description: string }[];
	packageUrl: string;
	sha256: string;
	sizeBytes: number;
	publisherKeyId: string;
	compatible: boolean;
	compatibilityReason: AgentPluginCompatibilityReason | null;
}

export interface PluginCatalog {
	repositoryUrl: string;
	publishers: { keyId: string; label: string; publicKeyPem: string }[];
	packages: PluginCatalogEntry[];
}

export interface PluginCatalogStage {
	repositoryUrl: string;
	publisherKeyId: string;
	packageId: string;
	version: string;
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
