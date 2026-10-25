import type {
	AgentProviderProtocol,
	AgentReasoningEffort,
	AgentModelCapabilityField,
	AgentModelCapabilitySource,
} from './values.js';

export interface AgentProviderModelInput {
	id: string;
	protocol?: AgentProviderProtocol;
	contextWindow?: number;
	maxOutputTokens?: number;
	supportsTools: boolean;
	supportsImageInput?: boolean;
	supportsImageGeneration?: boolean;
	supportsFileInput?: boolean;
	supportsPromptCacheKey?: boolean;
	reasoningEfforts?: AgentReasoningEffort[];
	defaultReasoningEffort?: AgentReasoningEffort;
	reasoningMandatory?: boolean;
}

export interface AgentProviderInput {
	kind: 'openai-compatible';
	displayName: string;
	baseUrl: string;
	protocol: AgentProviderProtocol;
	models: AgentProviderModelInput[];
	enabled: boolean;
	credential?: string;
	clearCredential?: boolean;
}

export interface AgentProviderModelView extends AgentProviderModelInput {
	capabilitySources: Partial<Record<AgentModelCapabilityField, AgentModelCapabilitySource>>;
	/** Provider observation timestamp is Unix milliseconds, not registry Unix seconds. */
	providerCapabilities?: {
		source: string;
		sourceVersion: string;
		updatedAt: number;
		capabilities: Partial<Omit<AgentProviderModelInput, 'id' | 'protocol'>>;
	};
	capabilityConflicts?: AgentModelCapabilityField[];
}

export interface AgentProviderView {
	id: string;
	kind: 'openai-compatible';
	displayName: string;
	baseUrl: string;
	protocol: AgentProviderProtocol;
	models: AgentProviderModelView[];
	enabled: boolean;
	hasCredential: boolean;
	credentialRevision: number;
	version: number;
	/** Provider persistence timestamps use Unix milliseconds. */
	createdAt: number;
	updatedAt: number;
}

export interface AgentAvailableModel {
	providerId: string;
	providerDisplayName: string;
	configurationVersion: number;
	model: AgentProviderModelView;
}

export interface AgentDiscoveredModel {
	id: string;
	ownedBy?: string;
	createdAt?: number;
	/** Only server-advertised capability facts; an absent value must not be inferred. */
	providerCapabilities?: Partial<Omit<AgentProviderModelInput, 'id' | 'protocol'>>;
}

export interface AgentProviderPatch {
	kind?: 'openai-compatible';
	displayName?: string;
	baseUrl?: string;
	protocol?: AgentProviderProtocol;
	models?: AgentProviderModelInput[];
	enabled?: boolean;
	credential?: string;
	clearCredential?: boolean;
}
