import {
	AGENT_PROVIDER_MODEL_LIMIT,
	AGENT_MODEL_CAPABILITY_FIELDS,
	AGENT_PROVIDER_MAX_MODEL_ID_BYTES,
	AGENT_PROVIDER_MAX_NAME_BYTES,
	AGENT_PROVIDER_MAX_SECRET_BYTES,
	AGENT_PROVIDER_MAX_URL_BYTES,
	AGENT_REASONING_EFFORTS,
} from '@nexus-terminal/shared/agent/providers/values';
import type { ProviderInput, ProviderModelInput, ProviderRecord, ProviderUsage } from './model/provider-types.js';
import { AgentFailure } from '../agent-failure.js';

export function shouldResetProviderObservations(current: ProviderRecord, input: ProviderInput): boolean {
	return (
		input.credential !== undefined ||
		input.clearCredential === true ||
		current.baseUrl !== input.baseUrl ||
		current.protocol !== input.protocol
	);
}

export function mayDeleteProvider(usage: ProviderUsage): boolean {
	return !usage.runStatuses.some((status) => status === 'pending' || status === 'running' || status === 'unknown');
}

function validText(value: unknown, maxBytes: number): value is string {
	return typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= maxBytes;
}

export function validateProviderInput(input: ProviderInput): void {
	if (
		input.kind !== 'openai-compatible' ||
		!validText(input.displayName, AGENT_PROVIDER_MAX_NAME_BYTES) ||
		!validText(input.baseUrl, AGENT_PROVIDER_MAX_URL_BYTES) ||
		!['responses', 'chat-completions', 'images'].includes(input.protocol) ||
		typeof input.enabled !== 'boolean' ||
		!Array.isArray(input.models) ||
		input.models.length < 1 ||
		input.models.length > AGENT_PROVIDER_MODEL_LIMIT
	) {
		throw new AgentFailure('invalid_input');
	}
	if (
		(input.credential !== undefined && !validText(input.credential, AGENT_PROVIDER_MAX_SECRET_BYTES)) ||
		(input.clearCredential !== undefined && typeof input.clearCredential !== 'boolean') ||
		(input.credential !== undefined && input.clearCredential === true)
	) {
		throw new AgentFailure('invalid_input');
	}
	const ids = new Set<string>();
	for (const model of input.models) {
		if (
			!validText(model.id, AGENT_PROVIDER_MAX_MODEL_ID_BYTES) ||
			ids.has(model.id.trim()) ||
			(model.contextWindow !== undefined &&
				(!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1)) ||
			(model.maxOutputTokens !== undefined &&
				(!Number.isSafeInteger(model.maxOutputTokens) || model.maxOutputTokens < 1)) ||
			(model.contextWindow !== undefined &&
				model.maxOutputTokens !== undefined &&
				model.maxOutputTokens > model.contextWindow) ||
			typeof model.supportsTools !== 'boolean' ||
			(model.protocol !== undefined && !['responses', 'chat-completions', 'images'].includes(model.protocol))
		) {
			throw new AgentFailure('invalid_input');
		}
		if (model.capabilitySources !== undefined) {
			for (const [field, source] of Object.entries(model.capabilitySources)) {
				if (source === undefined) {
					continue;
				}
				const key = AGENT_MODEL_CAPABILITY_FIELDS.find((item) => item === field);
				if (
					!key ||
					model[key] === undefined ||
					(source !== 'manual' && source !== 'provider' && source !== 'registry')
				) {
					throw new AgentFailure('invalid_input');
				}
			}
		}

		ids.add(model.id.trim());
		for (const value of [
			model.supportsImageInput,
			model.supportsImageGeneration,
			model.supportsFileInput,
			model.supportsPromptCacheKey,
			model.reasoningMandatory,
		]) {
			if (value !== undefined && typeof value !== 'boolean') {
				throw new AgentFailure('invalid_input');
			}
		}
		const efforts = model.reasoningEfforts;
		if (
			efforts !== undefined &&
			(!Array.isArray(efforts) ||
				efforts.length < 1 ||
				efforts.length > AGENT_REASONING_EFFORTS.length ||
				new Set(efforts).size !== efforts.length ||
				efforts.some((effort) => !AGENT_REASONING_EFFORTS.includes(effort)))
		) {
			throw new AgentFailure('invalid_input');
		}
		if (
			(model.defaultReasoningEffort !== undefined && !efforts?.includes(model.defaultReasoningEffort)) ||
			(model.reasoningMandatory === true && !efforts?.length)
		) {
			throw new AgentFailure('invalid_input');
		}
	}
}

export function cloneProviderModel(model: ProviderModelInput): ProviderModelInput {
	return {
		id: model.id,
		...(model.capabilitySources === undefined
			? {}
			: {
					capabilitySources: {
						contextWindow: model.capabilitySources.contextWindow,
						maxOutputTokens: model.capabilitySources.maxOutputTokens,
						supportsTools: model.capabilitySources.supportsTools,
						supportsImageInput: model.capabilitySources.supportsImageInput,
						supportsImageGeneration: model.capabilitySources.supportsImageGeneration,
						supportsFileInput: model.capabilitySources.supportsFileInput,
						supportsPromptCacheKey: model.capabilitySources.supportsPromptCacheKey,
						reasoningEfforts: model.capabilitySources.reasoningEfforts,
						defaultReasoningEffort: model.capabilitySources.defaultReasoningEffort,
						reasoningMandatory: model.capabilitySources.reasoningMandatory,
					},
				}),
		...(model.protocol === undefined ? {} : { protocol: model.protocol }),
		contextWindow: model.contextWindow,
		maxOutputTokens: model.maxOutputTokens,
		supportsTools: model.supportsTools,
		...(model.supportsImageInput === undefined ? {} : { supportsImageInput: model.supportsImageInput }),
		...(model.supportsImageGeneration === undefined
			? {}
			: { supportsImageGeneration: model.supportsImageGeneration }),
		...(model.supportsFileInput === undefined ? {} : { supportsFileInput: model.supportsFileInput }),
		...(model.supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey: model.supportsPromptCacheKey }),
		...(model.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...model.reasoningEfforts] }),
		...(model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort }),
		...(model.reasoningMandatory === undefined ? {} : { reasoningMandatory: model.reasoningMandatory }),
	};
}

export function normalizeProviderInput(input: ProviderInput): ProviderInput {
	return {
		kind: 'openai-compatible',
		displayName: input.displayName.trim(),
		baseUrl: input.baseUrl.trim(),
		protocol: input.protocol,
		models: input.models.map(cloneProviderModel),
		enabled: input.enabled,
		...(input.credential === undefined ? {} : { credential: input.credential }),
		...(input.clearCredential === undefined ? {} : { clearCredential: input.clearCredential }),
	};
}
