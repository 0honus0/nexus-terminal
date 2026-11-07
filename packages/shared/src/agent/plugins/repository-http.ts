import type { AgentPluginInstallation } from './model.js';
import type { AgentPluginInstallPlanRequest, AgentPluginInstallPlanResponse } from './install-plan.js';

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

export type AgentPluginRecommendedInstallRequest =
	| { kind: 'existing'; appId: string; expectedRevision: number }
	| { kind: 'plan'; plan: AgentPluginInstallPlanRequest };

export type AgentPluginRecommendedInstallResponse =
	| { kind: 'existing'; installation: AgentPluginInstallation }
	| { kind: 'installed'; result: AgentPluginInstallPlanResponse };
