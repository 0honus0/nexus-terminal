import type { AgentPluginEnablePlan, AgentPluginEnableRequest } from '@nexus-terminal/shared/agent/plugins/onboarding';
import type { PluginEnablePlan } from './plugin-onboarding-types';
import { fromPluginManifest, fromPluginPackageInstallation, fromPluginAppBinding } from './plugin-mapper';
import { fromPluginInstallPlan, toPluginInstallPlanRequest } from './plugin-install-plan-mapper';

export function fromPluginEnablePlan(value: AgentPluginEnablePlan): PluginEnablePlan {
	return {
		packages: value.packages.map((item) =>
			item.kind === 'plan'
				? { kind: 'plan', plan: fromPluginInstallPlan(item.plan) }
				: {
						kind: 'installed',
						installation: fromPluginPackageInstallation(item.installation),
						manifest: fromPluginManifest(item.manifest),
					},
		),
		bindings: value.bindings.map(fromPluginAppBinding),
		ready: value.ready,
	};
}

export function toPluginEnableRequest(value: PluginEnablePlan): AgentPluginEnableRequest {
	return {
		packages: value.packages.map((item) =>
			item.kind === 'plan'
				? { kind: 'plan', plan: toPluginInstallPlanRequest(item.plan, 'declared_grants') }
				: {
						kind: 'installed',
						expectedRevision: item.installation.revision,
						package: {
							packageId: item.installation.packageId,
							version: item.installation.version,
							packageHash: item.installation.packageHash,
							publisherKeyId: item.installation.publisherKeyId,
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
