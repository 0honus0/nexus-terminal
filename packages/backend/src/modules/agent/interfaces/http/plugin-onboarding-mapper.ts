import type { AgentPluginEnablePlan, AgentPluginEnableRequest } from '@nexus-terminal/shared/agent/plugins/onboarding';
import type { PluginEnablePlan, PluginEnableCommand } from '../../plugins/model/plugin-onboarding-types.js';
import { fromPluginInstallPlanRequest, toPluginInstallPlan } from './plugin-install-plan-mapper.js';
import { toPluginAppBinding, toManifest, toPluginPackageInstallation } from './plugin-mapper.js';

export function toPluginEnablePlan(value: PluginEnablePlan): AgentPluginEnablePlan {
	return {
		packages: value.packages.map((item) =>
			item.kind === 'plan'
				? { kind: 'plan', plan: toPluginInstallPlan(item.plan) }
				: {
						kind: 'installed',
						installation: toPluginPackageInstallation(item.installation),
						manifest: toManifest(item.manifest),
					},
		),
		bindings: value.bindings.map(toPluginAppBinding),
		ready: value.ready,
	};
}

export function fromPluginEnableRequest(value: AgentPluginEnableRequest): PluginEnableCommand {
	return {
		packages: value.packages.map((item) =>
			item.kind === 'plan'
				? { kind: 'plan', plan: fromPluginInstallPlanRequest(item.plan) }
				: {
						kind: 'installed',
						expectedRevision: item.expectedRevision,
						package: {
							packageId: item.package.packageId,
							version: item.package.version,
							packageHash: item.package.packageHash,
							publisherKeyId: item.package.publisherKeyId,
						},
					},
		),
		bindings: value.bindings.map((item) => ({
			appId: item.appId,
			executionRevision: item.executionRevision,
			uiRevision: item.uiRevision,
		})),
	};
}
