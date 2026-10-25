import type { AgentRegistryErrorCode } from '@nexus-terminal/shared/agent/providers/values';
import type { AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';

export interface StoredRegistryDefaults {
	contextWindow?: number;
	maxOutputTokens?: number;
	supportsTools?: boolean;
	supportsImageInput?: boolean;
	supportsImageGeneration?: boolean;
	supportsFileInput?: boolean;
	supportsPromptCacheKey?: boolean;
	reasoningEfforts?: AgentReasoningEffort[];
	defaultReasoningEffort?: AgentReasoningEffort;
	reasoningMandatory?: boolean;
}

export interface StoredRegistrySnapshot {
	schemaVersion: 2;
	source: 'models.dev';
	sourceRevision: string | null;
	generatedAt: number;
	entries: Record<string, StoredRegistryDefaults>;
}

export interface StoredCapabilityRegistryState {
	snapshot: StoredRegistrySnapshot | null;
	lastAttemptAt: number | null;
	lastSuccessAt: number | null;
	lastErrorCode: AgentRegistryErrorCode | null;
}

export interface StoredCapabilityRegistryRead extends StoredCapabilityRegistryState {
	snapshotInvalid: boolean;
}

export interface CapabilityRegistryStorage {
	load(): Promise<StoredCapabilityRegistryRead>;
	save(value: StoredCapabilityRegistryState): Promise<void>;
}
