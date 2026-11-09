import type { AgentCapability } from '../governance/values.js';
import type {
	AgentPluginStageStatus,
	AgentPluginInstallationStatus,
	AgentPluginPackageInstallationStatus,
	AGENT_PLUGIN_FRONTEND_SANDBOX,
} from './values.js';

export interface AgentPluginPublisher {
	keyId: string;
	publicKeyPem: string;
	label: string;
	version: number;
	createdAt: number;
	revokedAt: number | null;
}

export interface AgentPluginCompatibility {
	host: { minVersion: string; maxVersion: string };
	backendSdk: number | null;
	frontendSdk: number | null;
}

export interface AgentPluginManifest {
	schemaVersion: 4;
	id: string;
	version: string;
	displayName: string;
	requiredOnEnable?: boolean;
	compatibility: AgentPluginCompatibility;
	capabilities: AgentCapability[];
	intents: { id: string; schemaVersion: number }[];
	frontendEntry: string | null;
	backendEntry: string | null;
	contributions: import('./agent-extension.js').AgentPluginContribution;
	dependencies: import('./agent-extension.js').AgentPluginPackageDependency[];
	namespaces: string[];
}

export interface AgentPluginPackageReference {
	packageId: string;
	version: string;
	packageHash: string;
	publisherKeyId: string;
}

export interface AgentPluginPackageUpdateDependency {
	package: AgentPluginPackageReference;
	installationRevision: number;
}

export interface AgentPluginPackageInstallation {
	packageId: string;
	version: string;
	packageHash: string;
	publisherKeyId: string;
	status: AgentPluginPackageInstallationStatus;
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface AgentPluginAppBinding {
	appId: string;
	executionRevision: number;
	uiRevision: number;
	app: AgentPluginPackageReference;
	dependencies: AgentPluginPackageReference[];
	selectedRootIds: string[];
	ui: AgentPluginPackageReference | null;
}

export interface AgentPluginStage {
	id: string;
	packageHash: string;
	sizeBytes: number;
	status: AgentPluginStageStatus;
	version: number;
	publisherKeyId: string | null;
	manifest: AgentPluginManifest | null;
	createdAt: number;
	updatedAt: number;
}

export interface AgentPluginInstallation {
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

export interface AgentPluginVersion {
	manifest: AgentPluginManifest;
	packageHash: string;
	publisherKeyId: string;
}

export interface AgentPluginDescriptor {
	purpose: 'app' | 'settings';
	instanceId: string;
	appId: string;
	version: string;
	url: string;
	sdkVersion: '4';
	protocolVersion: 4;
	package: AgentPluginPackageReference;
	uiRevision: number;
	sandbox: typeof AGENT_PLUGIN_FRONTEND_SANDBOX;
	maxMessageBytes: number;
	requestTimeoutMs: number;
	expiresAt: number;
}

export interface AgentPluginData {
	key: string;
	version: number;
	valueJson: string | null;
	updatedAt: number;
}

export interface AgentPluginDataPurge {
	revision: number;
	deletedKeys: number;
	updatedAt: number;
}
