import type {
	PluginPackageReference,
	PluginPackageInstallation,
	PluginAppBinding,
} from './plugin-composition-types.js';

export interface PluginInstallPlanStagedCommand {
	repositoryUrl: string;
	stageId: string;
	expectedVersion: number;
	expectedInstallationRevision: number | null;
	package: PluginPackageReference;
}

export type PluginInstallPlanDependencyCommand =
	| {
			kind: 'staged';
			repositoryUrl: string;
			stageId: string;
			expectedVersion: number;
			expectedInstallationRevision: number | null;
			package: PluginPackageReference;
	  }
	| { kind: 'installed'; expectedRevision: number; package: PluginPackageReference };

export interface PluginInstallPlanCommand {
	initialization: 'disabled' | 'declared_grants';
	repositoryVersion: number;
	target: PluginInstallPlanStagedCommand;
	dependencies: PluginInstallPlanDependencyCommand[];
}

export interface PluginInstallPlanResult {
	installation: PluginPackageInstallation;
	binding: PluginAppBinding | null;
}
