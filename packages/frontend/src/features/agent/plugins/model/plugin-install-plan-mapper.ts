import { readAgentPluginInstallPlanRequest } from '@nexus-terminal/shared/agent/plugins/install-plan-codec';
import type { AgentPluginInstallPlanRequest } from '@nexus-terminal/shared/agent/plugins/install-plan';
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

export function toPluginInstallPlanRequest(
	plan: PluginInstallPlan,
	initialization: 'disabled' | 'declared_grants',
): AgentPluginInstallPlanRequest {
	const target = plan.target.stage;
	return readAgentPluginInstallPlanRequest({
		initialization,
		repositoryVersion: plan.repositoryVersion,
		target: {
			repositoryUrl: plan.target.repositoryUrl,
			stageId: target.id,
			expectedVersion: target.version,
			expectedInstallationRevision: plan.target.expectedInstallationRevision,
			package: {
				packageId: target.manifest.id,
				version: target.manifest.version,
				packageHash: target.packageHash,
				publisherKeyId: target.publisherKeyId,
			},
		},
		dependencies: plan.dependencies.map((dependency) =>
			dependency.kind === 'installed'
				? {
						kind: 'installed',
						expectedRevision: dependency.installation.revision,
						package: {
							packageId: dependency.installation.packageId,
							version: dependency.installation.version,
							packageHash: dependency.installation.packageHash,
							publisherKeyId: dependency.installation.publisherKeyId,
						},
					}
				: {
						kind: 'staged',
						repositoryUrl: dependency.repositoryUrl,
						stageId: dependency.stage.id,
						expectedVersion: dependency.stage.version,
						expectedInstallationRevision: dependency.expectedInstallationRevision,
						package: {
							packageId: dependency.stage.manifest.id,
							version: dependency.stage.manifest.version,
							packageHash: dependency.stage.packageHash,
							publisherKeyId: dependency.stage.publisherKeyId,
						},
					},
		),
	});
}
