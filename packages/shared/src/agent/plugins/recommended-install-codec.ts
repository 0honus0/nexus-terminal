import { agentRecord, agentInteger, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import { readAgentPluginInstallation } from './http-codec.js';
import { readAgentPluginInstallPlanRequest, readAgentPluginInstallPlanResponse } from './install-plan-codec.js';
import { AGENT_PLUGIN_MAX_BODY_BYTES, AGENT_PLUGIN_MAX_RESPONSE_BYTES } from './values.js';
import type { AgentPluginRecommendedInstallRequest, AgentPluginRecommendedInstallResponse } from './repository-http.js';

export function readAgentPluginRecommendedInstallRequest(input: unknown): AgentPluginRecommendedInstallRequest {
	const row = agentRecord(
		input,
		input !== null && typeof input === 'object' && 'kind' in input && input.kind === 'existing'
			? ['kind', 'appId', 'expectedRevision']
			: ['kind', 'plan'],
		AGENT_PLUGIN_MAX_BODY_BYTES,
	);
	if (row.kind === 'existing') {
		return {
			kind: 'existing',
			appId: readAgentId(row.appId),
			expectedRevision: agentInteger(row.expectedRevision, 1),
		};
	}
	if (row.kind !== 'plan') {
		throw new InvalidAgentPayload();
	}
	const plan = readAgentPluginInstallPlanRequest(row.plan);
	if (plan.initialization !== 'declared_grants') {
		throw new InvalidAgentPayload();
	}
	return { kind: 'plan', plan };
}

export function readAgentPluginRecommendedInstallResponse(
	input: unknown,
	request?: AgentPluginRecommendedInstallRequest,
): AgentPluginRecommendedInstallResponse {
	const row = agentRecord(
		input,
		input !== null && typeof input === 'object' && 'kind' in input && input.kind === 'existing'
			? ['kind', 'installation']
			: ['kind', 'result'],
		AGENT_PLUGIN_MAX_RESPONSE_BYTES,
	);
	if (row.kind === 'existing') {
		const installation = readAgentPluginInstallation(row.installation);
		if (
			installation.status !== 'installed' ||
			(request !== undefined &&
				(request.kind !== 'existing' ||
					installation.appId !== request.appId ||
					installation.revision !== request.expectedRevision))
		) {
			throw new InvalidAgentPayload();
		}
		return { kind: 'existing', installation };
	}
	if (row.kind !== 'installed' || (request !== undefined && request.kind !== 'plan')) {
		throw new InvalidAgentPayload();
	}
	return {
		kind: 'installed',
		result: readAgentPluginInstallPlanResponse(row.result, request?.kind === 'plan' ? request.plan : undefined),
	};
}
