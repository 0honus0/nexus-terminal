import { matchRegistryDefaults } from './registry-matcher.js';
import type {
	CapabilityRegistrySnapshot,
	CapabilityRegistryRead,
	CapabilityRegistryState,
	RegistryCatalogEntry,
	RegistryDefaults,
} from './model/registry-types.js';
import { RegistryRefreshFailure } from './model/registry-types.js';

// Retain the explicit corrections supplied by the pre-refactor resolver.
const LOCAL_CAPABILITIES: Readonly<Record<string, Partial<RegistryDefaults>>> = {
	'gpt-5.6': {
		supportsPromptCacheKey: true,
		reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
		defaultReasoningEffort: 'medium',
	},
	'gpt-5.6-sol': {
		supportsPromptCacheKey: true,
		reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
		defaultReasoningEffort: 'medium',
	},
	'gpt-5.6-terra': {
		supportsPromptCacheKey: true,
		reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
		defaultReasoningEffort: 'medium',
	},
	'gpt-5.6-luna': {
		supportsPromptCacheKey: true,
		reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
		defaultReasoningEffort: 'medium',
	},
	'gpt-5.1': {
		supportsPromptCacheKey: true,
		reasoningEfforts: ['none', 'low', 'medium', 'high'],
		defaultReasoningEffort: 'none',
	},
	'gpt-5-pro': {
		supportsPromptCacheKey: true,
		reasoningEfforts: ['high'],
		defaultReasoningEffort: 'high',
		reasoningMandatory: true,
	},
	'gpt-4o': { supportsPromptCacheKey: true },
};

export function buildRegistrySnapshot(
	items: RegistryCatalogEntry[],
	revision: string | null,
	now: number,
): CapabilityRegistrySnapshot {
	const entries: Record<string, RegistryDefaults> = Object.create(null);
	for (const item of items) {
		const value: RegistryDefaults = {
			contextWindow: item.capabilities.contextWindow,
			maxOutputTokens: item.capabilities.maxOutputTokens,
			...(item.capabilities.supportsTools === undefined
				? {}
				: { supportsTools: item.capabilities.supportsTools }),
			...(item.capabilities.supportsImageInput === undefined
				? {}
				: { supportsImageInput: item.capabilities.supportsImageInput }),
			...(item.capabilities.supportsImageGeneration === undefined
				? {}
				: { supportsImageGeneration: item.capabilities.supportsImageGeneration }),
			...(item.capabilities.supportsFileInput === undefined
				? {}
				: { supportsFileInput: item.capabilities.supportsFileInput }),
			...(item.capabilities.supportsPromptCacheKey === undefined
				? {}
				: { supportsPromptCacheKey: item.capabilities.supportsPromptCacheKey }),
			...(item.capabilities.defaultReasoningEffort === undefined
				? {}
				: { defaultReasoningEffort: item.capabilities.defaultReasoningEffort }),
			...(item.capabilities.reasoningMandatory === undefined
				? {}
				: { reasoningMandatory: item.capabilities.reasoningMandatory }),
			...(item.capabilities.reasoningEfforts === undefined
				? {}
				: { reasoningEfforts: [...item.capabilities.reasoningEfforts] }),
		};
		entries[item.providerId + '/' + item.modelId] = value;
	}
	if (Object.keys(entries).length > 5000) {
		throw new RegistryRefreshFailure('MODEL_REGISTRY_RESPONSE_INVALID');
	}
	return { schemaVersion: 2, source: 'models.dev', sourceRevision: revision, generatedAt: now, entries };
}

export function recoverRegistryState(state: CapabilityRegistryRead): CapabilityRegistryState {
	return {
		snapshot: state.snapshot,
		lastAttemptAt: state.lastAttemptAt,
		lastSuccessAt: state.snapshotInvalid ? null : state.lastSuccessAt,
		lastErrorCode: state.snapshotInvalid ? 'MODEL_REGISTRY_CACHE_INVALID' : state.lastErrorCode,
	};
}

export function resolveRegistryDefaults(state: CapabilityRegistryState, modelId: string): RegistryDefaults | null {
	const match = state.snapshot ? matchRegistryDefaults(state.snapshot.entries, modelId) : null;
	if (!match) {
		return null;
	}
	const entry = match.defaults;
	const override = LOCAL_CAPABILITIES[match.canonicalId.toLowerCase()];
	const reasoningEfforts = override?.reasoningEfforts ?? entry.reasoningEfforts;
	const defaultReasoningEffort =
		match.reasoningEffort && reasoningEfforts?.includes(match.reasoningEffort)
			? match.reasoningEffort
			: (override?.defaultReasoningEffort ?? entry.defaultReasoningEffort);
	const reasoningMandatory = override?.reasoningMandatory ?? entry.reasoningMandatory;
	const supportsPromptCacheKey = override?.supportsPromptCacheKey ?? entry.supportsPromptCacheKey;
	return {
		contextWindow: entry.contextWindow,
		maxOutputTokens: entry.maxOutputTokens,
		...(entry.supportsTools === undefined ? {} : { supportsTools: entry.supportsTools }),
		...(entry.supportsImageInput === undefined ? {} : { supportsImageInput: entry.supportsImageInput }),
		...(entry.supportsImageGeneration === undefined
			? {}
			: { supportsImageGeneration: entry.supportsImageGeneration }),
		...(entry.supportsFileInput === undefined ? {} : { supportsFileInput: entry.supportsFileInput }),
		...(supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey }),
		...(reasoningEfforts === undefined ? {} : { reasoningEfforts: [...reasoningEfforts] }),
		...(defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort }),
		...(reasoningMandatory === undefined ? {} : { reasoningMandatory }),
	};
}
