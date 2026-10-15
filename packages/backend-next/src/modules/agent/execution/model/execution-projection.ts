import type { StoredExecutionUsage } from '../storage/execution-storage.js';
import type { ExecutionUsage } from './execution-types.js';
import type { ExecutionLimits, ExecutionSettings, ExecutionProfile } from './execution-types.js';
import type {
	StoredExecutionLimits,
	StoredExecutionSettings,
	StoredExecutionProfile,
} from '../storage/execution-storage.js';

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

function fromProfile(value: StoredExecutionProfile): ExecutionProfile {
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

function toProfile(value: ExecutionProfile): StoredExecutionProfile {
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

export function fromSettings(value: StoredExecutionSettings): ExecutionSettings {
	return {
		contextCompactionMode: value.contextCompactionMode,
		contextProfile: value.contextProfile,
		version: value.version,
		enabled: value.enabled,
		limits: fromLimits(value.limits),
		hardLimits: fromLimits(value.hardLimits),
		profiles: value.profiles.map(fromProfile),
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
		profiles: value.profiles.map(toProfile),
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
