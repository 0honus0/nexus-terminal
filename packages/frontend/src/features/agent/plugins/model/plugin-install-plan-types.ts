import type { PluginStage, PluginManifest, PluginPackageInstallation, PluginAppBinding } from './plugin-types';

export type PluginPreparedStage = PluginStage & {
	status: 'verified' | 'installed';
	manifest: PluginManifest;
	publisherKeyId: string;
};

export type PluginInstallPlanDependency =
	| { kind: 'staged'; repositoryUrl: string; stage: PluginPreparedStage; expectedInstallationRevision: number | null }
	| { kind: 'installed'; installation: PluginPackageInstallation; manifest: PluginManifest };

export interface PluginInstallPlan {
	repositoryVersion: number;
	target: { repositoryUrl: string; stage: PluginPreparedStage; expectedInstallationRevision: number | null };
	dependencies: PluginInstallPlanDependency[];
}

export interface PluginInstallPlanResult {
	installation: PluginPackageInstallation;
	binding: PluginAppBinding | null;
}
