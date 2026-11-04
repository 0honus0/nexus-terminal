import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type {
	AgentPluginInstallationStatus,
	AgentPluginStageStatus,
} from '@nexus-terminal/shared/agent/plugins/values';

export interface PluginPublisher {
	keyId: string;
	publicKeyPem: string;
	label: string;
	version: number;
	createdAt: number;
	revokedAt: number | null;
}

export interface PluginManifest {
	id: string;
	version: string;
	displayName: string;
	sdkVersion: string;
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

export interface PluginVersion {
	manifest: PluginManifest;
	packageHash: string;
	publisherKeyId: string;
}

export interface PluginRepositories {
	version: number;
	urls: string[];
	updatedAt: number;
}

export interface PluginCatalogEntry {
	definitionId: string;
	version: string;
	sdkVersion: string;
	minVersion: string;
	maxVersion: string;
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

export interface PluginRecommendation {
	entry: PluginCatalogEntry | null;
	installation: PluginInstallation | null;
}

export interface PluginDataPurge {
	revision: number;
	deletedKeys: number;
	updatedAt: number;
}

export interface PluginFrontendDescriptor {
	appId: string;
	version: string;
	url: string;
	grant: string;
	sdkVersion: string;
	protocolVersion: 1;
	sandbox: 'allow-scripts';
	maxMessageBytes: number;
	requestTimeoutMs: number;
	expiresAt: number;
}
