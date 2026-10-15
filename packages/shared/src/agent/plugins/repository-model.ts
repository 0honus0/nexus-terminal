export interface AgentPluginRepositorySettings {
	version: number;
	repositories: { url: string }[];
	updatedAt: number;
}

export interface AgentPluginCatalogEntry {
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

export interface AgentPluginCatalog {
	schemaVersion: 1;
	repositoryUrl: string;
	publishers: { keyId: string; label: string; publicKeyPem: string }[];
	packages: AgentPluginCatalogEntry[];
}

export interface AgentPluginRecommended {
	entry: AgentPluginCatalogEntry | null;
	installation: import('./model.js').AgentPluginInstallation | null;
}
