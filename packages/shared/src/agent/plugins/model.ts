import type { AgentCapability } from '../governance/values.js';
import type { AgentPluginStageStatus, AgentPluginInstallationStatus } from './values.js';

export interface AgentPluginPublisher {
	keyId: string;
	publicKeyPem: string;
	label: string;
	version: number;
	createdAt: number;
	revokedAt: number | null;
}

export interface AgentPluginManifest {
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
	appId: string;
	version: string;
	url: string;
	sdkVersion: string;
	protocolVersion: 1;
	sandbox: 'allow-scripts';
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
