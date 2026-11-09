import type { PluginManifest } from './plugin-types.js';
import type { PluginInstallPlan } from './plugin-repository-types.js';
import type { PluginInstallPlanCommand } from './plugin-install-plan-types.js';
import type {
	PluginAppBinding,
	PluginPackageInstallation,
	PluginPackageReference,
} from './plugin-composition-types.js';

export type PluginEnablePackage =
	| { kind: 'installed'; installation: PluginPackageInstallation; manifest: PluginManifest }
	| { kind: 'plan'; plan: PluginInstallPlan };

export interface PluginEnablePlan {
	packages: PluginEnablePackage[];
	bindings: PluginAppBinding[];
	ready: boolean;
}

export interface PluginEnableCommand {
	packages: (
		| { kind: 'installed'; expectedRevision: number; package: PluginPackageReference }
		| { kind: 'plan'; plan: PluginInstallPlanCommand }
	)[];
	bindings: { appId: string; executionRevision: number; uiRevision: number }[];
}

export interface PluginEnableCandidate {
	package: PluginPackageReference;
	manifest: PluginManifest;
}

export interface PluginEnableComposition {
	packageId: string;
	appId: string | null;
	expectedBinding: { executionRevision: number; uiRevision: number } | null;
	selectedRootIds: string[];
	uiPackageId: string | null;
	expectedPackages: PluginPackageReference[];
}
