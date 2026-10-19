import type {
	AgentExecutionLimits,
	AgentExecutionSettingsView,
	AgentHardLimitPreviewView,
	AgentProfileModel,
} from '@nexus-terminal/shared/agent/execution/model';
import type { AgentExecutionSettingsUpdate } from '@nexus-terminal/shared/agent/execution/http';
import type { AgentProviderView } from '@nexus-terminal/shared/agent/providers/model';
import { AGENT_EXECUTION_PROFILE_MODEL_MAX_BYTES } from '@nexus-terminal/shared/agent/execution/values';
import type {
	ExecutionLimits,
	ExecutionSettings,
	ExecutionModel,
	ExecutionModelChoice,
	HardLimitConfirmation,
} from './execution-types';

export function fromExecutionLimits(value: AgentExecutionLimits): ExecutionLimits {
	return {
		maxModelRequests: value.maxModelRequests,
		maxToolExecutions: value.maxToolExecutions,
		maxActiveSeconds: value.maxActiveSeconds,
		toolTimeoutSeconds: value.toolTimeoutSeconds,
		maxToolOutputBytes: value.maxToolOutputBytes,
		maxTokenReservations: value.maxTokenReservations,
		maxConcurrentRuns: value.maxConcurrentRuns,
		maxConcurrentModelCalls: value.maxConcurrentModelCalls,
		maxChildren: value.maxChildren,
		maxMessages: value.maxMessages,
		maxMessageBytes: value.maxMessageBytes,
		maxRecallItems: value.maxRecallItems,
		maxRecallBytes: value.maxRecallBytes,
		maxSingleArtifactBytes: value.maxSingleArtifactBytes,
		maxArtifactBytes: value.maxArtifactBytes,
		artifactTtlSeconds: value.artifactTtlSeconds,
	};
}

export function toExecutionLimits(value: ExecutionLimits): AgentExecutionLimits {
	return {
		maxModelRequests: value.maxModelRequests,
		maxToolExecutions: value.maxToolExecutions,
		maxActiveSeconds: value.maxActiveSeconds,
		toolTimeoutSeconds: value.toolTimeoutSeconds,
		maxToolOutputBytes: value.maxToolOutputBytes,
		maxTokenReservations: value.maxTokenReservations,
		maxConcurrentRuns: value.maxConcurrentRuns,
		maxConcurrentModelCalls: value.maxConcurrentModelCalls,
		maxChildren: value.maxChildren,
		maxMessages: value.maxMessages,
		maxMessageBytes: value.maxMessageBytes,
		maxRecallItems: value.maxRecallItems,
		maxRecallBytes: value.maxRecallBytes,
		maxSingleArtifactBytes: value.maxSingleArtifactBytes,
		maxArtifactBytes: value.maxArtifactBytes,
		artifactTtlSeconds: value.artifactTtlSeconds,
	};
}

function fromProfileModel(value: AgentProfileModel): ExecutionModel {
	return value.kind === 'inherit'
		? { kind: 'inherit' }
		: {
				kind: 'explicit',
				providerId: value.providerId,
				modelId: value.modelId,
				configurationVersion: value.configurationVersion,
			};
}

function toProfileModel(value: ExecutionModel): AgentProfileModel {
	return value.kind === 'inherit'
		? { kind: 'inherit' }
		: {
				kind: 'explicit',
				providerId: value.providerId,
				modelId: value.modelId,
				configurationVersion: value.configurationVersion,
			};
}

export function fromExecutionSettings(value: AgentExecutionSettingsView): ExecutionSettings {
	return {
		version: value.version,
		enabled: value.enabled,
		limits: fromExecutionLimits(value.limits),
		hardLimits: fromExecutionLimits(value.hardLimits),
		profiles: value.profiles.map((profile) => ({
			name: profile.name,
			enabled: profile.enabled,
			model: fromProfileModel(profile.model),
			maxRequests: profile.maxRequests,
			maxSeconds: profile.maxSeconds,
			toolsText: profile.tools.join(', '),
		})),
		updatedAt: value.updatedAt,
	};
}

export function toExecutionUpdate(value: ExecutionSettings): AgentExecutionSettingsUpdate {
	return {
		expectedVersion: value.version,
		enabled: value.enabled,
		limits: toExecutionLimits(value.limits),
		profiles: value.profiles.map((profile) => ({
			name: profile.name,
			enabled: profile.enabled,
			model: toProfileModel(profile.model),
			maxRequests: profile.maxRequests,
			maxSeconds: profile.maxSeconds,
			tools: profile.toolsText.trim() === '' ? [] : profile.toolsText.split(',').map((tool) => tool.trim()),
		})),
	};
}

export function fromHardLimitConfirmation(value: AgentHardLimitPreviewView): HardLimitConfirmation {
	return {
		id: value.id,
		expectedVersion: value.expectedVersion,
		expiresAt: value.expiresAt,
		proposed: fromExecutionLimits(value.proposed),
		occupiedArtifactBytes: value.occupiedArtifactBytes,
		activeRuns: value.activeRuns,
	};
}

export function toExecutionModelChoices(providers: AgentProviderView[]): ExecutionModelChoice[] {
	const encoder = new TextEncoder();
	return providers
		.filter((provider) => provider.enabled)
		.flatMap((provider) =>
			provider.models
				.filter((model) => encoder.encode(model.id).byteLength <= AGENT_EXECUTION_PROFILE_MODEL_MAX_BYTES)
				.map((model) => ({
					key: JSON.stringify([provider.id, model.id, provider.version]),
					label: provider.displayName + ' / ' + model.id,
					providerId: provider.id,
					modelId: model.id,
					configurationVersion: provider.version,
				})),
		);
}
