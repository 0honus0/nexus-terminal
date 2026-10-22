import type { StoredExecutionUsage } from '../storage/execution-storage.js';
import type { ExecutionUsage } from './execution-types.js';
import type { ExecutionLimits, ExecutionSettings } from './execution-types.js';
import type { StoredExecutionLimits, StoredExecutionSettings } from '../storage/execution-storage.js';

export function fromLimits(value: StoredExecutionLimits): ExecutionLimits {
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

export function toLimits(value: ExecutionLimits): StoredExecutionLimits {
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

export function fromSettings(value: StoredExecutionSettings): ExecutionSettings {
	return {
		contextCompactionMode: value.contextCompactionMode,
		contextProfile: value.contextProfile,
		version: value.version,
		enabled: value.enabled,
		limits: fromLimits(value.limits),
		hardLimits: fromLimits(value.hardLimits),

		updatedAt: value.updatedAt,
	};
}

export function toSettings(value: ExecutionSettings): StoredExecutionSettings {
	return {
		contextCompactionMode: value.contextCompactionMode,
		contextProfile: value.contextProfile,
		version: value.version,
		enabled: value.enabled,
		limits: toLimits(value.limits),
		hardLimits: toLimits(value.hardLimits),

		updatedAt: value.updatedAt,
	};
}

export function fromUsage(value: StoredExecutionUsage): ExecutionUsage {
	return {
		rootId: value.rootId,
		modelRequests: value.modelRequests,
		toolExecutions: value.toolExecutions,
		reservedTokens: value.reservedTokens,
		concurrentModelCalls: value.concurrentModelCalls,
	};
}
