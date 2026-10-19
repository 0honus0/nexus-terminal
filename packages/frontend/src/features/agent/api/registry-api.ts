import {
	readAgentRegistryResolveQuery,
	readAgentRegistryResolveResponse,
	readAgentRegistryStatus,
} from '@nexus-terminal/shared/agent/providers/http-codec';
import {
	AGENT_PROVIDER_MAX_BODY_BYTES,
	AGENT_PROVIDER_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/providers/values';
import { fromRegistryDefaults, fromRegistryStatus } from '../model/registry-mapper';
import type { ModelRegistryDefaults, ModelRegistryStatus } from '../model/registry-types';
import { requestAgentManagement } from './management-request';
import { AgentManagementFailure } from '../model/management-failure';

export async function getModelRegistryStatus(signal?: AbortSignal): Promise<ModelRegistryStatus> {
	return fromRegistryStatus(
		await requestAgentManagement({
			method: 'GET',
			path: '/ai/model-registry',
			maxRequestBytes: AGENT_PROVIDER_MAX_BODY_BYTES,
			maxResponseBytes: AGENT_PROVIDER_MAX_RESPONSE_BYTES,
			decode: readAgentRegistryStatus,
			signal,
		}),
	);
}

export async function refreshModelRegistry(signal?: AbortSignal): Promise<ModelRegistryStatus> {
	return fromRegistryStatus(
		await requestAgentManagement({
			method: 'POST',
			path: '/ai/model-registry/refresh',

			input: () => ({}),

			maxRequestBytes: AGENT_PROVIDER_MAX_BODY_BYTES,
			maxResponseBytes: AGENT_PROVIDER_MAX_RESPONSE_BYTES,
			decode: readAgentRegistryStatus,
			signal,
		}),
	);
}

export async function resolveModelRegistry(
	modelId: string,
	signal?: AbortSignal,
): Promise<ModelRegistryDefaults | null> {
	let query;
	try {
		query = new URLSearchParams({ modelId });
		if (readAgentRegistryResolveQuery(query).modelId !== modelId) {
			throw new Error('Model identifier cannot be encoded without changes');
		}
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
	const response = await requestAgentManagement({
		method: 'GET',
		path: '/ai/model-registry/resolve?' + query,
		maxRequestBytes: AGENT_PROVIDER_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PROVIDER_MAX_RESPONSE_BYTES,

		decode(value) {
			const result = readAgentRegistryResolveResponse(value);
			if (result.modelId !== modelId) {
				throw new Error('Registry result belongs to another model');
			}
			return result;
		},

		signal,
	});
	return response.defaults === null ? null : fromRegistryDefaults(response.defaults);
}
