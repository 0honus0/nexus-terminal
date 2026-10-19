import type {
	AgentExecutionLimits,
	AgentExecutionProfile,
	AgentExecutionSettingsView,
	AgentHardLimitPreviewView,
} from '@nexus-terminal/shared/agent/execution/model';
import type {
	ExecutionLimits,
	ExecutionProfile,
	ExecutionSettings,
	HardLimitPreview,
} from '../../execution/model/execution-types.js';

function toLimits(value: ExecutionLimits): AgentExecutionLimits {
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

function toProfile(value: ExecutionProfile): AgentExecutionProfile {
	return {
		name: value.name,
		enabled: value.enabled,
		model:
			value.model.kind === 'inherit'
				? { kind: 'inherit' }
				: {
						kind: 'explicit',
						providerId: value.model.providerId,
						modelId: value.model.modelId,
						configurationVersion: value.model.configurationVersion,
					},
		maxRequests: value.maxRequests,
		maxSeconds: value.maxSeconds,
		tools: value.tools.map((tool) => tool),
	};
}

export function fromExecutionProfile(value: AgentExecutionProfile): ExecutionProfile {
	return {
		name: value.name,
		enabled: value.enabled,
		model:
			value.model.kind === 'inherit'
				? { kind: 'inherit' }
				: {
						kind: 'explicit',
						providerId: value.model.providerId,
						modelId: value.model.modelId,
						configurationVersion: value.model.configurationVersion,
					},
		maxRequests: value.maxRequests,
		maxSeconds: value.maxSeconds,
		tools: value.tools.map((tool) => tool),
	};
}

export function toExecutionSettings(value: ExecutionSettings): AgentExecutionSettingsView {
	return {
		version: value.version,
		enabled: value.enabled,
		limits: toLimits(value.limits),
		hardLimits: toLimits(value.hardLimits),
		profiles: value.profiles.map(toProfile),
		updatedAt: value.updatedAt,
	};
}

export function toHardLimitPreview(value: HardLimitPreview): AgentHardLimitPreviewView {
	return {
		id: value.id,
		expectedVersion: value.expectedVersion,
		expiresAt: value.expiresAt,
		proposed: toLimits(value.proposed),
		occupiedArtifactBytes: value.occupiedArtifactBytes,
		activeRuns: value.activeRuns,
	};
}
