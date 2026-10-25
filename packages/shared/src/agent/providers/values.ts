export const AGENT_PROVIDER_MODEL_LIMIT = 128;

export const AGENT_PROVIDER_MAX_BODY_BYTES = 128 * 1024;

export const AGENT_PROVIDER_MAX_NAME_BYTES = 128;

export const AGENT_PROVIDER_MAX_MODEL_ID_BYTES = 512;

export const AGENT_PROVIDER_MAX_SECRET_BYTES = 8192;

export const AGENT_PROVIDER_MAX_URL_BYTES = 2048;

export const AGENT_PROVIDER_DISCOVERY_LIMIT = 1000;

export const AGENT_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type AgentReasoningEffort = (typeof AGENT_REASONING_EFFORTS)[number];

export type AgentProviderProtocol = 'chat-completions' | 'responses' | 'images';

export const AGENT_MODEL_CAPABILITY_FIELDS = [
	'contextWindow',
	'maxOutputTokens',
	'supportsTools',
	'supportsImageInput',
	'supportsImageGeneration',
	'supportsFileInput',
	'supportsPromptCacheKey',
	'reasoningEfforts',
	'defaultReasoningEffort',
	'reasoningMandatory',
] as const;

export type AgentModelCapabilityField = (typeof AGENT_MODEL_CAPABILITY_FIELDS)[number];

export type AgentModelCapabilitySource = 'manual' | 'provider' | 'registry';

/** Whole JSON response budget, including escaping and observations. */
export const AGENT_PROVIDER_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export const AGENT_REGISTRY_MAX_MODEL_ID_BYTES = 256;

export const AGENT_REGISTRY_SOURCES = ['remote', 'unavailable'] as const;

export type AgentRegistrySource = (typeof AGENT_REGISTRY_SOURCES)[number];

export const AGENT_PROVIDER_FAILURE_CODES = [
	'PROVIDER_DNS_FAILED',
	'PROVIDER_TLS_FAILED',
	'PROVIDER_NETWORK_TIMEOUT',
	'PROVIDER_RESPONSE_TOO_LARGE',
	'PROVIDER_RESPONSE_INVALID',
	'PROVIDER_RESPONSE_EMPTY',
	'PROVIDER_STREAM_TRUNCATED',
	'PROVIDER_NETWORK_FAILED',
	'PROVIDER_STREAM_CLEANUP_FAILED',
	'PROVIDER_HTTP_ERROR',
	'PROVIDER_OUTPUT_TRUNCATED',
	'PROVIDER_CONTENT_FILTERED',
] as const;

export type AgentProviderFailureCode = (typeof AGENT_PROVIDER_FAILURE_CODES)[number] | `PROVIDER_HTTP_${number}`;

export const AGENT_REGISTRY_ERROR_CODES = [
	'MODEL_REGISTRY_HTTP',
	'MODEL_REGISTRY_NETWORK',
	'MODEL_REGISTRY_RESPONSE_INVALID',
	'MODEL_REGISTRY_TOO_LARGE',
	'MODEL_REGISTRY_CLEANUP_FAILED',
	'MODEL_REGISTRY_CACHE_INVALID',
] as const;

export type AgentRegistryErrorCode = (typeof AGENT_REGISTRY_ERROR_CODES)[number];
