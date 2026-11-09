import type { AgentPluginCompatibilityReason, AgentPluginContributionKind } from './values.js';

export interface AgentPluginRepositorySettings {
	version: number;
	repositories: { url: string }[];
	updatedAt: number;
}

export interface AgentPluginCatalogPackage {
	packageId: string;
	version: string;
	compatibility: import('./model.js').AgentPluginCompatibility;
	contributionKinds: AgentPluginContributionKind[];
	displayName: string;
	requiredOnEnable?: boolean;
	description: string;
	localizations?: { locale: string; displayName: string; description: string }[];
	packageUrl: string;
	sha256: string;
	sizeBytes: number;
	publisherKeyId: string;
}

export interface AgentPluginCatalogEntry extends AgentPluginCatalogPackage {
	compatible: boolean;
	compatibilityReason: AgentPluginCompatibilityReason | null;
}

export interface AgentPluginCatalogIndex {
	schemaVersion: 2;
	publishers: { keyId: string; label: string; publicKeyPem: string }[];
	packages: AgentPluginCatalogPackage[];
}

export interface AgentPluginCatalog {
	schemaVersion: 2;
	repositoryUrl: string;
	publishers: { keyId: string; label: string; publicKeyPem: string }[];
	packages: AgentPluginCatalogEntry[];
}
