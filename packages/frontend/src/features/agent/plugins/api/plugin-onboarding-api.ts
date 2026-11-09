import {
	readAgentPluginEnablePlan,
	readAgentPluginEnableRequest,
	readAgentPluginEnableResponse,
} from '@nexus-terminal/shared/agent/plugins/onboarding-codec';
import {
	AGENT_PLUGIN_MAX_BODY_BYTES,
	AGENT_PLUGIN_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import { requestAgentManagement } from '../../api/management-request';
import type { PluginEnablePlan } from '../model/plugin-onboarding-types';
import { fromPluginEnablePlan, toPluginEnableRequest } from '../model/plugin-onboarding-mapper';

const budgets = { maxRequestBytes: AGENT_PLUGIN_MAX_BODY_BYTES, maxResponseBytes: AGENT_PLUGIN_MAX_RESPONSE_BYTES };

export async function prepareAgentEnable(signal?: AbortSignal): Promise<PluginEnablePlan> {
	return fromPluginEnablePlan(
		await requestAgentManagement({
			...budgets,
			method: 'POST',
			path: '/onboarding/prepare',
			signal,
			decode: readAgentPluginEnablePlan,
		}),
	);
}

export async function installAgentRequirements(plan: PluginEnablePlan, signal?: AbortSignal): Promise<void> {
	const input = readAgentPluginEnableRequest(toPluginEnableRequest(plan));
	await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: '/onboarding/install',
		signal,

		input: () => input,

		decode(raw) {
			const result = readAgentPluginEnableResponse(raw);
			const apps = plan.packages.flatMap((item) => {
				const manifest = item.kind === 'plan' ? item.plan.target.stage.manifest : item.manifest;
				const reference =
					item.kind === 'plan'
						? {
								packageId: manifest.id,
								version: manifest.version,
								packageHash: item.plan.target.stage.packageHash,
								publisherKeyId: item.plan.target.stage.publisherKeyId,
							}
						: {
								packageId: manifest.id,
								version: manifest.version,
								packageHash: item.installation.packageHash,
								publisherKeyId: item.installation.publisherKeyId,
							};
				return manifest.appContribution === null ? [] : [reference];
			});
			if (
				result.bindings.some(
					(binding) =>
						!apps.some(
							(app) =>
								app.packageId === binding.app.packageId &&
								app.version === binding.app.version &&
								app.packageHash === binding.app.packageHash &&
								app.publisherKeyId === binding.app.publisherKeyId,
						),
				) ||
				apps.some((app) => !result.bindings.some((binding) => binding.app.packageId === app.packageId)) ||
				plan.bindings.some((previous) => !result.bindings.some((binding) => binding.appId === previous.appId))
			) {
				throw new Error('Required plugin composition mismatch');
			}
			return result;
		},
	});
}
