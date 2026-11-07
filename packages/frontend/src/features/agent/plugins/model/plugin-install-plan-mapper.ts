import type {
	AgentPluginInstallPlan,
	AgentPluginInstallPlanResponse,
} from '@nexus-terminal/shared/agent/plugins/install-plan';
import type { PluginInstallPlan, PluginInstallPlanResult } from './plugin-install-plan-types';
import {
	fromPluginStage,
	fromPluginManifest,
	fromPluginPackageInstallation,
	fromPluginAppBinding,
} from './plugin-mapper';

export function fromPluginInstallPlan(value: AgentPluginInstallPlan): PluginInstallPlan {
	return {
		repositoryVersion: value.repositoryVersion,
		target: {
			repositoryUrl: value.target.repositoryUrl,
			stage: fromPluginStage(value.target.stage),
			expectedInstallationRevision: value.target.expectedInstallationRevision,
		},
		dependencies: value.dependencies.map((dependency) =>
			dependency.kind === 'installed'
				? {
						kind: 'installed',
						installation: fromPluginPackageInstallation(dependency.installation),
						manifest: fromPluginManifest(dependency.manifest),
					}
				: {
						kind: 'staged',
						repositoryUrl: dependency.repositoryUrl,
						stage: fromPluginStage(dependency.stage),
						expectedInstallationRevision: dependency.expectedInstallationRevision,
					},
		),
	};
}

export function fromPluginInstallPlanResult(value: AgentPluginInstallPlanResponse): PluginInstallPlanResult {
	return {
		installation: fromPluginPackageInstallation(value.installation),
		binding: value.binding === null ? null : fromPluginAppBinding(value.binding),
	};
}
