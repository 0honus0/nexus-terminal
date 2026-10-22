import type {
	AgentExecutionLimits,
	AgentExecutionSettingsView,
	AgentHardLimitPreviewView,
} from '@nexus-terminal/shared/agent/execution/model';
import type { ExecutionLimits, ExecutionSettings, HardLimitPreview } from '../../execution/model/execution-types.js';

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

export function toExecutionSettings(value: ExecutionSettings): AgentExecutionSettingsView {
	return {
		version: value.version,
		enabled: value.enabled,
		limits: toLimits(value.limits),
		hardLimits: toLimits(value.hardLimits),

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
