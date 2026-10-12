import type { AgentProviderFailureCode } from './values.js';
import type {
	AgentProviderInput,
	AgentProviderPatch,
	AgentProviderView,
	AgentDiscoveredModel,
	AgentAvailableModel,
} from './model.js';

export type AgentProviderCreateRequest = AgentProviderInput;

export type AgentProviderUpdateRequest = AgentProviderPatch & { expectedVersion: number };

export type AgentProviderListResponse = AgentProviderView[];

export type AgentAvailableModelsResponse = AgentAvailableModel[];

export type AgentProviderDeleteResponse = { deleted: true };

export type AgentProviderDiscoverResponse = AgentDiscoveredModel[];

export interface AgentProviderDiscoverEndpointRequest {
	baseUrl: string;
	credential?: string;
}

export interface AgentProviderTestRequest {
	modelId: string;
}

export type AgentProviderTestResponse =
	| { ok: true; latencyMs: number; usage?: { inputTokens: number; outputTokens: number } }
	| { ok: false; latencyMs: number; errorCode: AgentProviderFailureCode };

export interface AgentProviderDeleteQuery {
	expectedVersion: number;
}

export interface AgentRegistryResolveQuery {
	modelId: string;
}
