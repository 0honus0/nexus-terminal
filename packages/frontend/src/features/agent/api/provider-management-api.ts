import {
	readAgentDiscoveredModels,
	readAgentProviderCreateRequest,
	readAgentProviderDeleteQuery,
	readAgentProviderDeleteResponse,
	readAgentProviderEmptyRequest,
	readAgentProviderEndpointRequest,
	readAgentProviderId,
	readAgentProviderListResponse,
	readAgentProviderTestRequest,
	readAgentProviderTestResponse,
	readAgentProviderUpdateRequest,
	readAgentProviderView,
} from '@nexus-terminal/shared/agent/providers/http-codec';
import {
	AGENT_PROVIDER_MAX_BODY_BYTES,
	AGENT_PROVIDER_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/providers/values';
import type { AgentProviderInput } from '@nexus-terminal/shared/agent/providers/model';
import { AgentManagementFailure } from '../model/management-failure';
import { fromDiscoveredModel, fromProvider, fromProviderTest, toProviderInput } from '../model/provider-mapper';
import type { DiscoveredProviderModel, Provider, ProviderDraft, ProviderTestResult } from '../model/provider-types';
import { requestAgentManagement } from './management-request';

const ROOT = '/ai/providers';

function providerPath(id: string): string {
	try {
		return ROOT + '/' + encodeURIComponent(readAgentProviderId(id));
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
}

function verifySaved(value: unknown, expected: AgentProviderInput | null, draft: ProviderDraft): Provider {
	const result = readAgentProviderView(value);
	if (
		!expected ||
		(draft.id !== null && (result.id !== draft.id || result.version !== (draft.version ?? 0) + 1)) ||
		(draft.id === null && result.version !== 1) ||
		result.displayName !== expected.displayName ||
		result.baseUrl !== new URL(expected.baseUrl).toString().replace(/\/$/, '') ||
		result.protocol !== expected.protocol ||
		result.enabled !== expected.enabled ||
		(expected.clearCredential === true && result.hasCredential) ||
		(expected.credential !== undefined && !result.hasCredential)
	) {
		throw new Error('Provider confirmation does not match the submitted configuration');
	}
	// Server adds capability provenance, but must preserve the explicit model configuration.
	if (
		result.models.length !== expected.models.length ||
		expected.models.some((model, index) => {
			const actual = result.models[index];
			return (
				!actual ||
				actual.id !== model.id ||
				actual.protocol !== model.protocol ||
				actual.contextWindow !== model.contextWindow ||
				actual.maxOutputTokens !== model.maxOutputTokens ||
				actual.supportsTools !== model.supportsTools ||
				actual.supportsImageInput !== model.supportsImageInput ||
				actual.supportsImageGeneration !== model.supportsImageGeneration ||
				actual.supportsFileInput !== model.supportsFileInput ||
				actual.supportsPromptCacheKey !== model.supportsPromptCacheKey ||
				actual.defaultReasoningEffort !== model.defaultReasoningEffort ||
				actual.reasoningMandatory !== model.reasoningMandatory ||
				JSON.stringify(actual.reasoningEfforts) !== JSON.stringify(model.reasoningEfforts)
			);
		})
	) {
		throw new Error('Provider confirmation has an unexpected model configuration');
	}
	return fromProvider(result);
}

export async function listManagedProviders(signal?: AbortSignal): Promise<Provider[]> {
	const result = await requestAgentManagement({
		method: 'GET',
		path: ROOT,
		maxRequestBytes: AGENT_PROVIDER_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PROVIDER_MAX_RESPONSE_BYTES,
		decode: readAgentProviderListResponse,
		signal,
	});
	return result.map(fromProvider);
}

export async function saveManagedProvider(draft: ProviderDraft, signal?: AbortSignal): Promise<Provider> {
	let expected: AgentProviderInput | null = null;
	return requestAgentManagement({
		method: draft.id === null ? 'POST' : 'PATCH',
		path: draft.id === null ? ROOT : providerPath(draft.id),
		expectedStatus: draft.id === null ? 201 : 200,
		maxRequestBytes: AGENT_PROVIDER_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PROVIDER_MAX_RESPONSE_BYTES,

		input() {
			expected = readAgentProviderCreateRequest(toProviderInput(draft));
			const url = new URL(expected.baseUrl);
			if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
				throw new Error('Invalid Provider endpoint');
			}
			if (draft.id === null) {
				if (expected.clearCredential) {
					throw new Error('A new Provider has no credential to clear');
				}
				return expected;
			}
			return readAgentProviderUpdateRequest({
				expectedVersion: draft.version,
				kind: expected.kind,
				displayName: expected.displayName,
				baseUrl: expected.baseUrl,
				protocol: expected.protocol,
				models: expected.models,
				enabled: expected.enabled,
				credential: expected.credential,
				clearCredential: expected.clearCredential,
			});
		},

		decode: (value) => verifySaved(value, expected, draft),

		signal,
	});
}

export async function deleteManagedProvider(provider: Provider, signal?: AbortSignal): Promise<void> {
	let query: string;
	try {
		if (!Number.isSafeInteger(provider.version) || provider.version < 1) {
			throw new Error('Invalid Provider version');
		}
		const params = new URLSearchParams({ expectedVersion: String(provider.version) });
		readAgentProviderDeleteQuery(params);
		query = params.toString();
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
	await requestAgentManagement({
		method: 'DELETE',
		path: providerPath(provider.id) + '?' + query,
		maxRequestBytes: AGENT_PROVIDER_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PROVIDER_MAX_RESPONSE_BYTES,
		decode: readAgentProviderDeleteResponse,
		signal,
	});
}

export async function discoverManagedProvider(id: string, signal?: AbortSignal): Promise<DiscoveredProviderModel[]> {
	const result = await requestAgentManagement({
		method: 'POST',
		path: providerPath(id) + '/discover-models',

		input() {
			readAgentProviderEmptyRequest({});
			return {};
		},

		maxRequestBytes: AGENT_PROVIDER_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PROVIDER_MAX_RESPONSE_BYTES,
		decode: readAgentDiscoveredModels,
		signal,
	});
	return result.map(fromDiscoveredModel);
}

export async function discoverProviderEndpoint(
	baseUrl: string,
	credential: string | undefined,
	signal?: AbortSignal,
): Promise<DiscoveredProviderModel[]> {
	const result = await requestAgentManagement({
		method: 'POST',
		path: ROOT + '/discover-endpoint-models',

		input: () => readAgentProviderEndpointRequest({ baseUrl, credential }),

		maxRequestBytes: AGENT_PROVIDER_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PROVIDER_MAX_RESPONSE_BYTES,
		decode: readAgentDiscoveredModels,
		signal,
	});
	return result.map(fromDiscoveredModel);
}

export async function testManagedProvider(
	id: string,
	modelId: string,
	signal?: AbortSignal,
): Promise<ProviderTestResult> {
	const result = await requestAgentManagement({
		method: 'POST',
		path: providerPath(id) + '/test',

		input: () => readAgentProviderTestRequest({ modelId }),

		maxRequestBytes: AGENT_PROVIDER_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PROVIDER_MAX_RESPONSE_BYTES,
		decode: readAgentProviderTestResponse,
		signal,
	});
	return fromProviderTest(result);
}
