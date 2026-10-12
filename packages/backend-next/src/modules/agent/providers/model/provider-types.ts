import type { AgentProviderFailureCode } from '@nexus-terminal/shared/agent/providers/values';
import type { AgentProviderProtocol, AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import type {
	AgentModelCapabilityField,
	AgentModelCapabilitySource,
} from '@nexus-terminal/shared/agent/providers/values';

/** Internal Agent application types, not Shared HTTP objects or SQL rows. */
export interface ProviderModelInput {
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

export interface ProviderInput {
	kind: 'openai-compatible';
	displayName: string;
	baseUrl: string;
	protocol: AgentProviderProtocol;
	models: ProviderModelInput[];
	enabled: boolean;
	credential?: string;
	clearCredential?: boolean;
}

export interface ProviderModelView extends ProviderModelInput {
	capabilitySources: Partial<Record<AgentModelCapabilityField, AgentModelCapabilitySource>>;
	providerCapabilities?: {
		source: string;
		sourceVersion: string;
		updatedAt: number;
		capabilities: Partial<Omit<ProviderModelInput, 'id' | 'protocol'>>;
	};
	capabilityConflicts?: AgentModelCapabilityField[];
}

export interface ProviderView {
	id: string;
	kind: 'openai-compatible';
	displayName: string;
	baseUrl: string;
	protocol: AgentProviderProtocol;
	models: ProviderModelView[];
	enabled: boolean;
	hasCredential: boolean;
	credentialRevision: number;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface DiscoveredModel {
	id: string;
	ownedBy?: string;
	createdAt?: number;
	providerCapabilities?: Partial<Omit<ProviderModelInput, 'id' | 'protocol'>>;
}

export interface ProviderObservation {
	modelId: string;
	source: string;
	sourceVersion: string;
	updatedAt: number;
	capabilities: Partial<Omit<ProviderModelInput, 'id' | 'protocol'>>;
}

export interface ModelReference {
	providerId: string;
	modelId: string;
	configurationVersion: number;
}

export interface FrozenModelInput {
	providerId: string;
	providerVersion: number;
	credentialRevision: number;
	modelId: string;
	baseUrl: string;
	protocol: AgentProviderProtocol;
	capabilities: ProviderModelInput;
	/** Unresolved B6 tool, approval and B7 policy cannot be interpreted as approval. */
	executionPolicy: 'awaiting_b6_b7';
}

export type ProviderTestResult =
	| { ok: true; latencyMs: number; usage?: { inputTokens: number; outputTokens: number } }
	| { ok: false; latencyMs: number; errorCode: AgentProviderFailureCode };

export interface ProviderRecord {
	id: string;
	userId: number;
	displayName: string;
	baseUrl: string;
	protocol: AgentProviderProtocol;
	models: ProviderModelInput[];
	observations: ProviderObservation[];
	enabled: boolean;
	hasCredential: boolean;
	credentialRevision: number;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface ProviderPatch {
	kind?: 'openai-compatible';
	displayName?: string;
	baseUrl?: string;
	protocol?: AgentProviderProtocol;
	models?: ProviderModelInput[];
	enabled?: boolean;
	credential?: string;
	clearCredential?: boolean;
}

export type ProviderMutation =
	{ status: 'ok'; provider: ProviderRecord } | { status: 'not_found' | 'version_conflict' };

export interface ProviderWriteCommand {
	userId: number;
	id: string;
	input: ProviderInput;
	now: number;
}

export interface ProviderProbeCommand {
	baseUrl: string;
	protocol: AgentProviderProtocol;
	modelId: string;
	credential: string | null;
	maxOutputTokens: number;
	reasoningEffort?: AgentReasoningEffort;
	usesReasoning: boolean;
}

export interface ProviderProbeResult {
	usage?: { inputTokens: number; outputTokens: number };
}

export interface AvailableModel {
	providerId: string;
	providerDisplayName: string;
	configurationVersion: number;
	model: ProviderModelView;
}

export type ProviderDeletion = { status: 'ok' } | { status: 'not_found' | 'version_conflict' | 'provider_in_use' };

export interface ProviderUsage {
	runStatuses: AgentRunStatus[];
}
