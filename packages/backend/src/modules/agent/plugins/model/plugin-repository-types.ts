import type { PluginManifest, PluginStage } from './plugin-types.js';
import type { PluginPackageInstallation } from './plugin-composition-types.js';

export type PluginInstallPlanStage = PluginStage & {
	status: 'verified' | 'installed';
	manifest: PluginManifest;
	publisherKeyId: string;
};

export function isPluginInstallPlanStage(value: PluginStage): value is PluginInstallPlanStage {
	return (
		(value.status === 'verified' || value.status === 'installed') &&
		value.manifest !== null &&
		value.publisherKeyId !== null
	);
}

export type PluginInstallPlanDependency =
	| {
			kind: 'staged';
			repositoryUrl: string;
			stage: PluginInstallPlanStage;
			expectedInstallationRevision: number | null;
	  }
	| { kind: 'installed'; installation: PluginPackageInstallation; manifest: PluginManifest };

export interface PluginInstallPlan {
	repositoryVersion: number;
	target: { repositoryUrl: string; stage: PluginInstallPlanStage; expectedInstallationRevision: number | null };
	dependencies: PluginInstallPlanDependency[];
}
