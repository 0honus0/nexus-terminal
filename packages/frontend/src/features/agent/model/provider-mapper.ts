import type {
	AgentDiscoveredModel,
	AgentProviderInput,
	AgentProviderModelInput,
	AgentProviderModelView,
	AgentProviderView,
} from '@nexus-terminal/shared/agent/providers/model';
import type { AgentProviderTestResponse } from '@nexus-terminal/shared/agent/providers/http';
import type {
	DiscoveredProviderModel,
	Provider,
	ProviderCapabilities,
	ProviderDraft,
	ProviderModel,
	ProviderModelDraft,
	ProviderTestResult,
} from './provider-types';

function fromCapabilities(value: NonNullable<AgentDiscoveredModel['providerCapabilities']>): ProviderCapabilities {
	return {
		contextWindow: value.contextWindow,
		maxOutputTokens: value.maxOutputTokens,
		supportsTools: value.supportsTools,
		supportsImageInput: value.supportsImageInput,
		supportsImageGeneration: value.supportsImageGeneration,
		supportsFileInput: value.supportsFileInput,
		supportsPromptCacheKey: value.supportsPromptCacheKey,
		reasoningEfforts: value.reasoningEfforts?.map((effort) => effort),
		defaultReasoningEffort: value.defaultReasoningEffort,
		reasoningMandatory: value.reasoningMandatory,
	};
}

export function toProviderModel(value: ProviderModelDraft): AgentProviderModelInput {
	return {
		capabilitySources: {
			contextWindow: value.sources.contextWindow,
			maxOutputTokens: value.sources.maxOutputTokens,
			supportsTools: value.sources.supportsTools,
			supportsImageInput: value.sources.supportsImageInput,
			supportsImageGeneration: value.sources.supportsImageGeneration,
			supportsFileInput: value.sources.supportsFileInput,
			supportsPromptCacheKey: value.sources.supportsPromptCacheKey,
			reasoningEfforts: value.sources.reasoningEfforts,
			defaultReasoningEffort: value.sources.defaultReasoningEffort,
			reasoningMandatory: value.sources.reasoningMandatory,
		},
		id: value.id,
		protocol: value.protocol,
		contextWindow: value.contextWindow,
		maxOutputTokens: value.maxOutputTokens,
		supportsTools: value.supportsTools,
		supportsImageInput: value.supportsImageInput,
		supportsImageGeneration: value.supportsImageGeneration,
		supportsFileInput: value.supportsFileInput,
		supportsPromptCacheKey: value.supportsPromptCacheKey,
		reasoningEfforts: value.reasoningEfforts?.map((effort) => effort),
		defaultReasoningEffort: value.defaultReasoningEffort,
		reasoningMandatory: value.reasoningMandatory,
	};
}

function fromModel(value: AgentProviderModelView): ProviderModel {
	return {
		id: value.id,
		protocol: value.protocol,
		contextWindow: value.contextWindow,
		maxOutputTokens: value.maxOutputTokens,
		supportsTools: value.supportsTools,
		supportsImageInput: value.supportsImageInput,
		supportsImageGeneration: value.supportsImageGeneration,
		supportsFileInput: value.supportsFileInput,
		supportsPromptCacheKey: value.supportsPromptCacheKey,
		reasoningEfforts: value.reasoningEfforts?.map((effort) => effort),
		defaultReasoningEffort: value.defaultReasoningEffort,
		reasoningMandatory: value.reasoningMandatory,
		sources: {
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
		observation:
			value.providerCapabilities === undefined
				? undefined
				: {
						source: value.providerCapabilities.source,
						revision: value.providerCapabilities.sourceVersion,
						observedAt: value.providerCapabilities.updatedAt,
						capabilities: fromCapabilities(value.providerCapabilities.capabilities),
					},
		conflicts: value.capabilityConflicts?.map((field) => field) ?? [],
	};
}

export function fromProvider(value: AgentProviderView): Provider {
	return {
		id: value.id,
		name: value.displayName,
		baseUrl: value.baseUrl,
		protocol: value.protocol,
		models: value.models.map(fromModel),
		enabled: value.enabled,
		hasCredential: value.hasCredential,
		credentialRevision: value.credentialRevision,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toProviderInput(value: ProviderDraft): AgentProviderInput {
	return {
		kind: 'openai-compatible',
		displayName: value.name,
		baseUrl: value.baseUrl,
		protocol: value.protocol,
		models: value.models.map(toProviderModel),
		enabled: value.enabled,
		credential: value.credential.action === 'replace' ? value.credential.value : undefined,
		clearCredential: value.credential.action === 'clear' ? true : undefined,
	};
}

export function fromDiscoveredModel(value: AgentDiscoveredModel): DiscoveredProviderModel {
	return {
		id: value.id,
		owner: value.ownedBy,
		createdAt: value.createdAt,
		capabilities:
			value.providerCapabilities === undefined ? undefined : fromCapabilities(value.providerCapabilities),
	};
}

export function fromProviderTest(value: AgentProviderTestResponse): ProviderTestResult {
	if (!value.ok) {
		return { ok: false, latencyMs: value.latencyMs, errorCode: value.errorCode };
	}
	return {
		ok: true,
		latencyMs: value.latencyMs,
		usage:
			value.usage === undefined
				? undefined
				: {
						inputTokens: value.usage.inputTokens,
						outputTokens: value.usage.outputTokens,
					},
	};
}

export function createProviderDraft(value: Provider | null): ProviderDraft {
	return {
		id: value?.id ?? null,
		version: value?.version ?? null,
		name: value?.name ?? '',
		baseUrl: value?.baseUrl ?? '',
		protocol: value?.protocol ?? 'chat-completions',
		enabled: value?.enabled ?? true,
		credential: { action: 'keep' },
		models:
			value?.models.map((model) => ({
				sources: {
					contextWindow: model.sources.contextWindow,
					maxOutputTokens: model.sources.maxOutputTokens,
					supportsTools: model.sources.supportsTools,
					supportsImageInput: model.sources.supportsImageInput,
					supportsImageGeneration: model.sources.supportsImageGeneration,
					supportsFileInput: model.sources.supportsFileInput,
					supportsPromptCacheKey: model.sources.supportsPromptCacheKey,
					reasoningEfforts: model.sources.reasoningEfforts,
					defaultReasoningEffort: model.sources.defaultReasoningEffort,
					reasoningMandatory: model.sources.reasoningMandatory,
				},
				id: model.id,
				protocol: model.protocol,
				contextWindow: model.contextWindow,
				maxOutputTokens: model.maxOutputTokens,
				supportsTools: model.supportsTools,
				supportsImageInput: model.supportsImageInput,
				supportsImageGeneration: model.supportsImageGeneration,
				supportsFileInput: model.supportsFileInput,
				supportsPromptCacheKey: model.supportsPromptCacheKey,
				reasoningEfforts: model.reasoningEfforts?.map((effort) => effort),
				defaultReasoningEffort: model.defaultReasoningEffort,
				reasoningMandatory: model.reasoningMandatory,
			})) ?? [],
	};
}
