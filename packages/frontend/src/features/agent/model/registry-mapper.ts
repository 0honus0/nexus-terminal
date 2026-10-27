import type { AgentRegistryDefaults, AgentRegistryStatus } from '@nexus-terminal/shared/agent/providers/registry';
import type { ModelRegistryDefaults, ModelRegistryStatus } from './registry-types';

export function fromRegistryStatus(value: AgentRegistryStatus): ModelRegistryStatus {
	return {
		sourceUrl: value.sourceUrl,
		activeSource: value.activeSource,
		entryCount: value.entryCount,
		generatedAt: value.generatedAt === null ? null : value.generatedAt * 1000,
		sourceRevision: value.sourceRevision,
		lastAttemptAt: value.lastAttemptAt === null ? null : value.lastAttemptAt * 1000,
		lastSuccessAt: value.lastSuccessAt === null ? null : value.lastSuccessAt * 1000,
		lastErrorCode: value.lastErrorCode,
	};
}

export function fromRegistryDefaults(value: AgentRegistryDefaults): ModelRegistryDefaults {
	return {
		contextWindow: value.contextWindow,
		maxOutputTokens: value.maxOutputTokens,
		...(value.supportsTools === undefined ? {} : { supportsTools: value.supportsTools }),
		...(value.supportsImageInput === undefined ? {} : { supportsImageInput: value.supportsImageInput }),
		...(value.supportsImageGeneration === undefined
			? {}
			: { supportsImageGeneration: value.supportsImageGeneration }),
		...(value.supportsFileInput === undefined ? {} : { supportsFileInput: value.supportsFileInput }),
		...(value.supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey: value.supportsPromptCacheKey }),
		...(value.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...value.reasoningEfforts] }),
		...(value.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: value.defaultReasoningEffort }),
		...(value.reasoningMandatory === undefined ? {} : { reasoningMandatory: value.reasoningMandatory }),
	};
}
