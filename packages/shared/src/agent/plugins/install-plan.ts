import type { AgentPluginInstallInitialization } from './values.js';
import type {
	AgentPluginAppBinding,
	AgentPluginManifest,
	AgentPluginPackageInstallation,
	AgentPluginPackageReference,
	AgentPluginStage,
} from './model.js';

export interface AgentPluginInstallPlanStage extends AgentPluginStage {
	status: 'verified' | 'installed';
	manifest: AgentPluginManifest;
	publisherKeyId: string;
}

export type AgentPluginInstallPlanDependency =
	| {
			kind: 'staged';
			repositoryUrl: string;
			stage: AgentPluginInstallPlanStage;
			expectedInstallationRevision: number | null;
	  }
	| { kind: 'installed'; installation: AgentPluginPackageInstallation; manifest: AgentPluginManifest };

export interface AgentPluginInstallPlan {
	repositoryVersion: number;
	target: { repositoryUrl: string; stage: AgentPluginInstallPlanStage; expectedInstallationRevision: number | null };
	dependencies: AgentPluginInstallPlanDependency[];
}

export interface AgentPluginInstallPlanStagedRequest {
	repositoryUrl: string;
	stageId: string;
	expectedVersion: number;
	expectedInstallationRevision: number | null;
	package: AgentPluginPackageReference;
}

export type AgentPluginInstallPlanDependencyRequest =
	| (AgentPluginInstallPlanStagedRequest & { kind: 'staged' })
	| { kind: 'installed'; expectedRevision: number; package: AgentPluginPackageReference };

export interface AgentPluginInstallPlanRequest {
	initialization: AgentPluginInstallInitialization;
	repositoryVersion: number;
	target: AgentPluginInstallPlanStagedRequest;
	dependencies: AgentPluginInstallPlanDependencyRequest[];
}

export interface AgentPluginInstallPlanResponse {
	installation: AgentPluginPackageInstallation;
	binding: AgentPluginAppBinding | null;
}
