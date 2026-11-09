import type {
	AgentPluginAppBinding,
	AgentPluginManifest,
	AgentPluginPackageInstallation,
	AgentPluginPackageReference,
} from './model.js';
import type { AgentPluginInstallPlan, AgentPluginInstallPlanRequest } from './install-plan.js';

export type AgentPluginEnablePackage =
	| { kind: 'installed'; installation: AgentPluginPackageInstallation; manifest: AgentPluginManifest }
	| { kind: 'plan'; plan: AgentPluginInstallPlan };

export interface AgentPluginEnablePlan {
	packages: AgentPluginEnablePackage[];
	bindings: AgentPluginAppBinding[];
	ready: boolean;
}

export interface AgentPluginEnableRequest {
	packages: (
		| { kind: 'installed'; expectedRevision: number; package: AgentPluginPackageReference }
		| { kind: 'plan'; plan: AgentPluginInstallPlanRequest }
	)[];
	bindings: { appId: string; executionRevision: number; uiRevision: number }[];
}

export interface AgentPluginEnableResponse {
	bindings: AgentPluginAppBinding[];
}
