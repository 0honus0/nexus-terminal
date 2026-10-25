import type { RegistryDefaults, CapabilityRegistrySnapshot } from './registry-types.js';
import type { StoredRegistryDefaults, StoredRegistrySnapshot } from '../storage/registry-storage.js';

function fromStoredDefaults(value: StoredRegistryDefaults): RegistryDefaults {
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

function toStoredDefaults(value: RegistryDefaults): StoredRegistryDefaults {
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

export function fromStoredSnapshot(value: StoredRegistrySnapshot): CapabilityRegistrySnapshot {
	const entries: CapabilityRegistrySnapshot['entries'] = Object.create(null);
	for (const [key, defaults] of Object.entries(value.entries)) {
		entries[key] = fromStoredDefaults(defaults);
	}
	return {
		schemaVersion: value.schemaVersion,
		source: value.source,
		sourceRevision: value.sourceRevision,
		generatedAt: value.generatedAt,
		entries,
	};
}

export function toStoredSnapshot(value: CapabilityRegistrySnapshot): StoredRegistrySnapshot {
	const entries: StoredRegistrySnapshot['entries'] = Object.create(null);
	for (const [key, defaults] of Object.entries(value.entries)) {
		entries[key] = toStoredDefaults(defaults);
	}
	return {
		schemaVersion: value.schemaVersion,
		source: value.source,
		sourceRevision: value.sourceRevision,
		generatedAt: value.generatedAt,
		entries,
	};
}
