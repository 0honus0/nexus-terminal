export interface AgentPluginRepositoryUpdate {
	expectedVersion: number;
	repositories: { url: string }[];
}

export interface AgentPluginRepositoryStage {
	repositoryUrl: string;
	appId: string;
	version: string;
}

export interface AgentPluginOfficialStage {
	appId: string;
	version: string;
}

export interface AgentPluginRemoteCatalogQuery {
	repositoryUrl: string;
}

export type AgentPluginRecommendedInstallRequest = Record<string, never>;
