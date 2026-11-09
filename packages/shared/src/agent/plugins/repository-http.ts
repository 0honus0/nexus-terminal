export interface AgentPluginRepositoryUpdate {
	expectedVersion: number;
	repositories: { url: string }[];
}

export interface AgentPluginRepositoryStage {
	repositoryUrl: string;
	packageId: string;
	publisherKeyId: string;
	version: string;
}

export interface AgentPluginOfficialStage {
	packageId: string;
	publisherKeyId: string;
	version: string;
}

export interface AgentPluginRemoteCatalogQuery {
	repositoryUrl: string;
}
