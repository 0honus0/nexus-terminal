import type {
	AgentPluginInstallPlan,
	AgentPluginInstallPlanResponse,
	AgentPluginInstallPlanRequest,
} from '@nexus-terminal/shared/agent/plugins/install-plan';
import type { AgentPluginPackageReference } from '@nexus-terminal/shared/agent/plugins/model';
import type { PluginInstallPlan } from '../../plugins/model/plugin-repository-types.js';
import type {
	PluginInstallPlanCommand,
	PluginInstallPlanResult,
} from '../../plugins/model/plugin-install-plan-types.js';
import type { PluginPackageReference } from '../../plugins/model/plugin-composition-types.js';
import { toPluginStage, toManifest, toPluginPackageInstallation, toPluginAppBinding } from './plugin-mapper.js';

function fromReference(value: AgentPluginPackageReference): PluginPackageReference {
	return {
		packageId: value.packageId,
		version: value.version,
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
	};
}

export function fromPluginInstallPlanRequest(value: AgentPluginInstallPlanRequest): PluginInstallPlanCommand {
	return {
		initialization: value.initialization,
		repositoryVersion: value.repositoryVersion,
		target: {
			repositoryUrl: value.target.repositoryUrl,
			stageId: value.target.stageId,
			expectedVersion: value.target.expectedVersion,
			expectedInstallationRevision: value.target.expectedInstallationRevision,
			package: fromReference(value.target.package),
		},
		dependencies: value.dependencies.map((dependency) =>
			dependency.kind === 'installed'
				? {
						kind: 'installed',
						expectedRevision: dependency.expectedRevision,
						package: fromReference(dependency.package),
					}
				: {
						kind: 'staged',
						repositoryUrl: dependency.repositoryUrl,
						stageId: dependency.stageId,
						expectedVersion: dependency.expectedVersion,
						expectedInstallationRevision: dependency.expectedInstallationRevision,
						package: fromReference(dependency.package),
					},
		),
	};
}

export function toPluginInstallPlan(value: PluginInstallPlan): AgentPluginInstallPlan {
	return {
		repositoryVersion: value.repositoryVersion,
		target: {
			repositoryUrl: value.target.repositoryUrl,
			stage: toPluginStage(value.target.stage),
			expectedInstallationRevision: value.target.expectedInstallationRevision,
		},
		dependencies: value.dependencies.map((dependency) =>
			dependency.kind === 'installed'
				? {
						kind: 'installed',
						installation: toPluginPackageInstallation(dependency.installation),
						manifest: toManifest(dependency.manifest),
					}
				: {
						kind: 'staged',
						repositoryUrl: dependency.repositoryUrl,
						stage: toPluginStage(dependency.stage),
						expectedInstallationRevision: dependency.expectedInstallationRevision,
					},
		),
	};
}

export function toPluginInstallPlanResult(value: PluginInstallPlanResult): AgentPluginInstallPlanResponse {
	return {
		installation: toPluginPackageInstallation(value.installation),
		binding: value.binding === null ? null : toPluginAppBinding(value.binding),
	};
}
