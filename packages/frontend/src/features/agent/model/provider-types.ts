import type {
	AgentModelCapabilityField,
	AgentModelCapabilitySource,
	AgentProviderFailureCode,
	AgentProviderProtocol,
	AgentReasoningEffort,
} from '@nexus-terminal/shared/agent/providers/values';

export interface ProviderCapabilities {
	contextWindow?: number;
	maxOutputTokens?: number;
	supportsTools?: boolean;
	supportsImageInput?: boolean;
	supportsFileInput?: boolean;
	supportsPromptCacheKey?: boolean;
	reasoningEfforts?: AgentReasoningEffort[];
	defaultReasoningEffort?: AgentReasoningEffort;
	reasoningMandatory?: boolean;
}

export interface ProviderModelDraft {
	id: string;
	protocol?: AgentProviderProtocol;
	contextWindow: number;
	maxOutputTokens: number;
	supportsTools: boolean;
	supportsImageInput?: boolean;
	supportsFileInput?: boolean;
	supportsPromptCacheKey?: boolean;
	reasoningEfforts?: AgentReasoningEffort[];
	defaultReasoningEffort?: AgentReasoningEffort;
	reasoningMandatory?: boolean;
}

export interface ProviderModel extends ProviderModelDraft {
	sources: Partial<Record<AgentModelCapabilityField, AgentModelCapabilitySource>>;
	observation?: {
		source: string;
		revision: string;
		observedAt: number;
		capabilities: ProviderCapabilities;
	};
	conflicts: AgentModelCapabilityField[];
}

export interface Provider {
	id: string;
	name: string;
	baseUrl: string;
	protocol: AgentProviderProtocol;
	models: ProviderModel[];
	enabled: boolean;
	hasCredential: boolean;
	credentialRevision: number;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export type ProviderCredential = { action: 'keep' } | { action: 'clear' } | { action: 'replace'; value: string };

export interface ProviderDraft {
	id: string | null;
	version: number | null;
	name: string;
	baseUrl: string;
	protocol: AgentProviderProtocol;
	models: ProviderModelDraft[];
	enabled: boolean;
	credential: ProviderCredential;
}

export interface DiscoveredProviderModel {
	id: string;
	owner?: string;
	createdAt?: number;
	capabilities?: ProviderCapabilities;
}

export type ProviderTestResult =
	| { ok: true; latencyMs: number; usage?: { inputTokens: number; outputTokens: number } }
	| { ok: false; latencyMs: number; errorCode: AgentProviderFailureCode };
