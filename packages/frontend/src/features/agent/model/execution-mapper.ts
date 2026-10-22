import type {
	AgentExecutionLimits,
	AgentExecutionSettingsView,
	AgentHardLimitPreviewView,
} from '@nexus-terminal/shared/agent/execution/model';
import type { AgentExecutionSettingsUpdate } from '@nexus-terminal/shared/agent/execution/http';

import type { ExecutionLimits, ExecutionSettings, HardLimitConfirmation } from './execution-types';

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

export function fromExecutionSettings(value: AgentExecutionSettingsView): ExecutionSettings {
	return {
		version: value.version,
		enabled: value.enabled,
		limits: fromExecutionLimits(value.limits),
		hardLimits: fromExecutionLimits(value.hardLimits),
		updatedAt: value.updatedAt,
	};
}

export function toExecutionUpdate(value: ExecutionSettings): AgentExecutionSettingsUpdate {
	return {
		expectedVersion: value.version,
		enabled: value.enabled,
		limits: toExecutionLimits(value.limits),
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
