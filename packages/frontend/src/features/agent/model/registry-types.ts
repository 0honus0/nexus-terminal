import type {
	AgentReasoningEffort,
	AgentRegistryErrorCode,
	AgentRegistrySource,
} from '@nexus-terminal/shared/agent/providers/values';

export interface ModelRegistryStatus {
	sourceUrl: string;
	activeSource: AgentRegistrySource;
	entryCount: number;
	generatedAt: number | null;
	sourceRevision: string | null;
	lastAttemptAt: number | null;
	lastSuccessAt: number | null;
	lastErrorCode: AgentRegistryErrorCode | null;
}

export interface ModelRegistryDefaults {
	contextWindow: number;
	maxOutputTokens: number;
	supportsTools?: boolean;
	supportsImageInput?: boolean;
	supportsFileInput?: boolean;
	reasoningEfforts?: AgentReasoningEffort[];
}
