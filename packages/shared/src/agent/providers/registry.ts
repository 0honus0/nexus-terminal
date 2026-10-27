import type { AgentRegistryErrorCode, AgentRegistrySource } from './values.js';
import type { AgentReasoningEffort } from './values.js';

export interface AgentRegistryDefaults {
	contextWindow?: number;
	maxOutputTokens?: number;
	/** Missing vendor information is unknown, not false. */
	supportsTools?: boolean;
	supportsImageInput?: boolean;
	supportsImageGeneration?: boolean;
	supportsFileInput?: boolean;
	supportsPromptCacheKey?: boolean;
	reasoningEfforts?: AgentReasoningEffort[];
	defaultReasoningEffort?: AgentReasoningEffort;
	reasoningMandatory?: boolean;
}

export interface AgentRegistryStatus {
	sourceUrl: string;
	activeSource: AgentRegistrySource;
	entryCount: number;
	/** Registry generation timestamp uses Unix seconds. */
	generatedAt: number | null;
	sourceRevision: string | null;
	lastAttemptAt: number | null;
	lastSuccessAt: number | null;
	lastErrorCode: AgentRegistryErrorCode | null;
}

export interface AgentRegistryResolveResponse {
	modelId: string;
	defaults: AgentRegistryDefaults | null;
}
