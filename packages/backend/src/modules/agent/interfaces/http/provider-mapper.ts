import type {
	AgentProviderInput,
	AgentProviderPatch,
	AgentProviderModelInput,
	AgentProviderModelView,
	AgentProviderView,
	AgentAvailableModel,
	AgentDiscoveredModel,
} from '@nexus-terminal/shared/agent/providers/model';
import type {
	ProviderInput,
	ProviderPatch,
	ProviderView,
	ProviderModelInput,
	ProviderModelView,
	DiscoveredModel,
	ProviderTestResult,
} from '../../providers/model/provider-types.js';
import type { AgentProviderTestResponse } from '@nexus-terminal/shared/agent/providers/http';
import type {
	AgentRegistryResolveResponse,
	AgentRegistryStatus,
	AgentRegistryDefaults,
} from '@nexus-terminal/shared/agent/providers/registry';
import type {
	RegistryDefaults,
	RegistryResolution,
	RegistryStatus,
} from '../../providers/registry/model/registry-types.js';

/** Interface-only whitelist from validated wire fields to the Agent application command. */
function appModel(model: AgentProviderModelInput): ProviderModelInput {
	return {
		id: model.id,
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

export function appProvider(input: AgentProviderInput): ProviderInput {
	return {
		kind: 'openai-compatible',
		displayName: input.displayName,
		baseUrl: input.baseUrl,
		protocol: input.protocol,
		models: input.models.map(appModel),
		enabled: input.enabled,
		...(input.credential === undefined ? {} : { credential: input.credential }),
		...(input.clearCredential === undefined ? {} : { clearCredential: input.clearCredential }),
	};
}

function wireCapabilities(
	capabilities: Partial<Omit<ProviderModelInput, 'id' | 'protocol'>>,
): Partial<Omit<AgentProviderModelInput, 'id' | 'protocol'>> {
	return {
		...(capabilities.contextWindow === undefined ? {} : { contextWindow: capabilities.contextWindow }),
		...(capabilities.maxOutputTokens === undefined ? {} : { maxOutputTokens: capabilities.maxOutputTokens }),
		...(capabilities.supportsTools === undefined ? {} : { supportsTools: capabilities.supportsTools }),
		...(capabilities.supportsImageInput === undefined
			? {}
			: { supportsImageInput: capabilities.supportsImageInput }),
		...(capabilities.supportsImageGeneration === undefined
			? {}
			: { supportsImageGeneration: capabilities.supportsImageGeneration }),
		...(capabilities.supportsFileInput === undefined ? {} : { supportsFileInput: capabilities.supportsFileInput }),
		...(capabilities.supportsPromptCacheKey === undefined
			? {}
			: { supportsPromptCacheKey: capabilities.supportsPromptCacheKey }),
		...(capabilities.reasoningEfforts === undefined
			? {}
			: { reasoningEfforts: [...capabilities.reasoningEfforts] }),
		...(capabilities.defaultReasoningEffort === undefined
			? {}
			: { defaultReasoningEffort: capabilities.defaultReasoningEffort }),
		...(capabilities.reasoningMandatory === undefined
			? {}
			: { reasoningMandatory: capabilities.reasoningMandatory }),
	};
}

function wireModel(model: ProviderModelView): AgentProviderModelView {
	return {
		id: model.id,
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
		capabilitySources: {
			...(model.capabilitySources.contextWindow === undefined
				? {}
				: { contextWindow: model.capabilitySources.contextWindow }),
			...(model.capabilitySources.maxOutputTokens === undefined
				? {}
				: { maxOutputTokens: model.capabilitySources.maxOutputTokens }),
			...(model.capabilitySources.supportsTools === undefined
				? {}
				: { supportsTools: model.capabilitySources.supportsTools }),
			...(model.capabilitySources.supportsImageInput === undefined
				? {}
				: { supportsImageInput: model.capabilitySources.supportsImageInput }),
			...(model.capabilitySources.supportsImageGeneration === undefined
				? {}
				: { supportsImageGeneration: model.capabilitySources.supportsImageGeneration }),
			...(model.capabilitySources.supportsFileInput === undefined
				? {}
				: { supportsFileInput: model.capabilitySources.supportsFileInput }),
			...(model.capabilitySources.supportsPromptCacheKey === undefined
				? {}
				: { supportsPromptCacheKey: model.capabilitySources.supportsPromptCacheKey }),
			...(model.capabilitySources.reasoningEfforts === undefined
				? {}
				: { reasoningEfforts: model.capabilitySources.reasoningEfforts }),
			...(model.capabilitySources.defaultReasoningEffort === undefined
				? {}
				: { defaultReasoningEffort: model.capabilitySources.defaultReasoningEffort }),
			...(model.capabilitySources.reasoningMandatory === undefined
				? {}
				: { reasoningMandatory: model.capabilitySources.reasoningMandatory }),
		},
		...(model.providerCapabilities === undefined
			? {}
			: {
					providerCapabilities: {
						source: model.providerCapabilities.source,
						sourceVersion: model.providerCapabilities.sourceVersion,
						updatedAt: model.providerCapabilities.updatedAt,
						capabilities: wireCapabilities(model.providerCapabilities.capabilities),
					},
				}),
		...(model.capabilityConflicts === undefined ? {} : { capabilityConflicts: [...model.capabilityConflicts] }),
	};
}

export function wireProvider(provider: ProviderView): AgentProviderView {
	return {
		id: provider.id,
		kind: 'openai-compatible',
		displayName: provider.displayName,
		baseUrl: provider.baseUrl,
		protocol: provider.protocol,
		models: provider.models.map(wireModel),
		enabled: provider.enabled,
		hasCredential: provider.hasCredential,
		credentialRevision: provider.credentialRevision,
		version: provider.version,
		createdAt: provider.createdAt,
		updatedAt: provider.updatedAt,
	};
}

export function wireDiscovered(model: DiscoveredModel): AgentDiscoveredModel {
	return {
		id: model.id,
		...(model.ownedBy === undefined ? {} : { ownedBy: model.ownedBy }),
		...(model.createdAt === undefined ? {} : { createdAt: model.createdAt }),
		...(model.providerCapabilities === undefined
			? {}
			: {
					providerCapabilities: wireCapabilities(model.providerCapabilities),
				}),
	};
}

export function wireAvailable(model: {
	providerId: string;
	providerDisplayName: string;
	configurationVersion: number;
	model: ProviderModelView;
}): AgentAvailableModel {
	return {
		providerId: model.providerId,
		providerDisplayName: model.providerDisplayName,
		configurationVersion: model.configurationVersion,
		model: wireModel(model.model),
	};
}

export function wireTest(result: ProviderTestResult): AgentProviderTestResponse {
	if (result.ok) {
		return {
			ok: true,
			latencyMs: result.latencyMs,
			...(result.usage === undefined
				? {}
				: {
						usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
					}),
		};
	}
	return { ok: false, latencyMs: result.latencyMs, errorCode: result.errorCode };
}

function wireRegistryDefaults(value: RegistryDefaults): AgentRegistryDefaults {
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

export function wireRegistryResolution(value: RegistryResolution): AgentRegistryResolveResponse {
	return { modelId: value.modelId, defaults: value.defaults === null ? null : wireRegistryDefaults(value.defaults) };
}

export function wireRegistryStatus(value: RegistryStatus): AgentRegistryStatus {
	return {
		sourceUrl: value.sourceUrl,
		activeSource: value.activeSource,
		entryCount: value.entryCount,
		generatedAt: value.generatedAt === null ? null : Math.floor(value.generatedAt / 1000),
		sourceRevision: value.sourceRevision,
		lastAttemptAt: value.lastAttemptAt === null ? null : Math.floor(value.lastAttemptAt / 1000),
		lastSuccessAt: value.lastSuccessAt === null ? null : Math.floor(value.lastSuccessAt / 1000),
		lastErrorCode: value.lastErrorCode,
	};
}

export function appProviderPatch(input: AgentProviderPatch): ProviderPatch {
	return {
		...(input.kind === undefined ? {} : { kind: input.kind }),
		...(input.displayName === undefined ? {} : { displayName: input.displayName }),
		...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
		...(input.protocol === undefined ? {} : { protocol: input.protocol }),
		...(input.models === undefined ? {} : { models: input.models.map(appModel) }),
		...(input.enabled === undefined ? {} : { enabled: input.enabled }),
		...(input.credential === undefined ? {} : { credential: input.credential }),
		...(input.clearCredential === undefined ? {} : { clearCredential: input.clearCredential }),
	};
}
