import { AgentFailure } from '../agent-failure.js';
import type {
	ProviderRecord,
	FrozenModelInput,
	ModelReference,
	ProviderObservation,
	ProviderModelInput,
} from './model/provider-types.js';

/**
 * Observations are untrusted third-party capability statements. An absent field
 * is unknown, not false. Manual limits may be narrower than observed limits.
 */
function allowedByObservation(model: ProviderModelInput, observation: ProviderObservation | undefined): boolean {
	if (!observation) {
		return true;
	}
	const reported = observation.capabilities;
	if (
		reported.contextWindow !== undefined &&
		model.contextWindow !== undefined &&
		model.contextWindow > reported.contextWindow
	) {
		return false;
	}
	if (
		reported.maxOutputTokens !== undefined &&
		model.maxOutputTokens !== undefined &&
		model.maxOutputTokens > reported.maxOutputTokens
	) {
		return false;
	}
	for (const key of [
		'supportsTools',
		'supportsImageInput',
		'supportsImageGeneration',
		'supportsFileInput',
		'supportsPromptCacheKey',
	] as const) {
		if (model[key] === true && reported[key] === false) {
			return false;
		}
	}
	const supportedEfforts = reported.reasoningEfforts;
	if (supportedEfforts !== undefined) {
		if (model.reasoningEfforts?.some((effort) => !supportedEfforts.includes(effort))) {
			return false;
		}
		if (model.defaultReasoningEffort !== undefined && !supportedEfforts.includes(model.defaultReasoningEffort)) {
			return false;
		}
	}
	if (
		reported.reasoningMandatory === true &&
		(model.reasoningMandatory !== true || !model.reasoningEfforts?.length)
	) {
		return false;
	}
	return true;
}

/** Pure application resolution; SQLite Adapter only controls the transaction. */
export function resolveFrozenModel(provider: ProviderRecord, reference: ModelReference): FrozenModelInput | null {
	if (
		!provider.enabled ||
		provider.id !== reference.providerId ||
		provider.version !== reference.configurationVersion
	) {
		return null;
	}

	const selected = provider.models.find((candidate) => candidate.id === reference.modelId);
	if (
		!selected ||
		((selected.protocol ?? provider.protocol) !== 'images' &&
			(selected.contextWindow === undefined || selected.maxOutputTokens === undefined))
	) {
		return null;
	}

	const observation = provider.observations.find((item) => item.modelId === selected.id);
	if (!allowedByObservation(selected, observation)) {
		return null;
	}

	const reasoningEffort = reference.reasoningEffort ?? selected.defaultReasoningEffort;
	if (
		reference.reasoningEffort !== undefined &&
		((selected.protocol ?? provider.protocol) === 'images' ||
			!selected.reasoningEfforts?.includes(reference.reasoningEffort) ||
			(selected.reasoningMandatory === true && reference.reasoningEffort === 'none'))
	) {
		throw new AgentFailure('invalid_input');
	}
	return {
		providerId: provider.id,
		providerVersion: provider.version,
		credentialRevision: provider.credentialRevision,
		modelId: selected.id,
		baseUrl: provider.baseUrl,
		protocol: selected.protocol ?? provider.protocol,
		capabilities: {
			id: selected.id,
			...(selected.protocol === undefined ? {} : { protocol: selected.protocol }),
			contextWindow: selected.contextWindow,
			maxOutputTokens: selected.maxOutputTokens,
			supportsTools: selected.supportsTools,
			...(selected.supportsImageInput === undefined ? {} : { supportsImageInput: selected.supportsImageInput }),
			...(selected.supportsImageGeneration === undefined
				? {}
				: { supportsImageGeneration: selected.supportsImageGeneration }),
			...(selected.supportsFileInput === undefined ? {} : { supportsFileInput: selected.supportsFileInput }),
			...(selected.supportsPromptCacheKey === undefined
				? {}
				: { supportsPromptCacheKey: selected.supportsPromptCacheKey }),
			...(selected.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...selected.reasoningEfforts] }),
			...(reasoningEffort === undefined ? {} : { defaultReasoningEffort: reasoningEffort }),
			...(selected.reasoningMandatory === undefined ? {} : { reasoningMandatory: selected.reasoningMandatory }),
		},
		executionPolicy: 'governed',
	};
}
