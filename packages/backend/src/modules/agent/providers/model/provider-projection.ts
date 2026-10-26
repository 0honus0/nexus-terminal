import type { ProviderStoredRow, StoredProviderModel, StoredProviderObservation } from '../storage/provider-storage.js';
import type { ProviderRecord, ProviderModelInput, ProviderObservation } from './provider-types.js';

export function fromStoredModel(value: StoredProviderModel): ProviderModelInput {
	return {
		id: value.id,
		...(value.capabilitySources === undefined
			? {}
			: {
					capabilitySources: {
						contextWindow: value.capabilitySources.contextWindow,
						maxOutputTokens: value.capabilitySources.maxOutputTokens,
						supportsTools: value.capabilitySources.supportsTools,
						supportsImageInput: value.capabilitySources.supportsImageInput,
						supportsImageGeneration: value.capabilitySources.supportsImageGeneration,
						supportsFileInput: value.capabilitySources.supportsFileInput,
						supportsPromptCacheKey: value.capabilitySources.supportsPromptCacheKey,
						reasoningEfforts: value.capabilitySources.reasoningEfforts,
						defaultReasoningEffort: value.capabilitySources.defaultReasoningEffort,
						reasoningMandatory: value.capabilitySources.reasoningMandatory,
					},
				}),
		contextWindow: value.contextWindow,
		maxOutputTokens: value.maxOutputTokens,
		supportsTools: value.supportsTools,
		...(value.protocol === undefined ? {} : { protocol: value.protocol }),
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

export function toStoredModel(value: ProviderModelInput): StoredProviderModel {
	return {
		id: value.id,
		...(value.capabilitySources === undefined
			? {}
			: {
					capabilitySources: {
						contextWindow: value.capabilitySources.contextWindow,
						maxOutputTokens: value.capabilitySources.maxOutputTokens,
						supportsTools: value.capabilitySources.supportsTools,
						supportsImageInput: value.capabilitySources.supportsImageInput,
						supportsImageGeneration: value.capabilitySources.supportsImageGeneration,
						supportsFileInput: value.capabilitySources.supportsFileInput,
						supportsPromptCacheKey: value.capabilitySources.supportsPromptCacheKey,
						reasoningEfforts: value.capabilitySources.reasoningEfforts,
						defaultReasoningEffort: value.capabilitySources.defaultReasoningEffort,
						reasoningMandatory: value.capabilitySources.reasoningMandatory,
					},
				}),
		contextWindow: value.contextWindow,
		maxOutputTokens: value.maxOutputTokens,
		supportsTools: value.supportsTools,
		...(value.protocol === undefined ? {} : { protocol: value.protocol }),
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

function fromStoredObservation(value: StoredProviderObservation): ProviderObservation {
	const c = value.capabilities;
	return {
		modelId: value.modelId,
		source: value.source,
		sourceVersion: value.sourceVersion,
		updatedAt: value.updatedAt,
		capabilities: {
			...(c.contextWindow === undefined ? {} : { contextWindow: c.contextWindow }),
			...(c.maxOutputTokens === undefined ? {} : { maxOutputTokens: c.maxOutputTokens }),
			...(c.supportsTools === undefined ? {} : { supportsTools: c.supportsTools }),
			...(c.supportsImageInput === undefined ? {} : { supportsImageInput: c.supportsImageInput }),
			...(c.supportsImageGeneration === undefined ? {} : { supportsImageGeneration: c.supportsImageGeneration }),
			...(c.supportsFileInput === undefined ? {} : { supportsFileInput: c.supportsFileInput }),
			...(c.supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey: c.supportsPromptCacheKey }),
			...(c.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...c.reasoningEfforts] }),
			...(c.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: c.defaultReasoningEffort }),
			...(c.reasoningMandatory === undefined ? {} : { reasoningMandatory: c.reasoningMandatory }),
		},
	};
}

export function fromStoredProvider(value: ProviderStoredRow): ProviderRecord {
	return {
		id: value.id,
		userId: value.userId,
		displayName: value.displayName,
		baseUrl: value.baseUrl,
		protocol: value.protocol,
		models: value.models.map(fromStoredModel),
		observations: value.observations.map(fromStoredObservation),
		enabled: value.enabled,
		hasCredential: value.hasCredential,
		credentialRevision: value.credentialRevision,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toStoredObservation(value: ProviderObservation): StoredProviderObservation {
	const c = value.capabilities;
	return {
		modelId: value.modelId,
		source: value.source,
		sourceVersion: value.sourceVersion,
		updatedAt: value.updatedAt,
		capabilities: {
			...(c.contextWindow === undefined ? {} : { contextWindow: c.contextWindow }),
			...(c.maxOutputTokens === undefined ? {} : { maxOutputTokens: c.maxOutputTokens }),
			...(c.supportsTools === undefined ? {} : { supportsTools: c.supportsTools }),
			...(c.supportsImageInput === undefined ? {} : { supportsImageInput: c.supportsImageInput }),
			...(c.supportsImageGeneration === undefined ? {} : { supportsImageGeneration: c.supportsImageGeneration }),
			...(c.supportsFileInput === undefined ? {} : { supportsFileInput: c.supportsFileInput }),
			...(c.supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey: c.supportsPromptCacheKey }),
			...(c.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...c.reasoningEfforts] }),
			...(c.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: c.defaultReasoningEffort }),
			...(c.reasoningMandatory === undefined ? {} : { reasoningMandatory: c.reasoningMandatory }),
		},
	};
}
