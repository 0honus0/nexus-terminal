import type {} from '@nexus-terminal/shared/agent/governance/values';

export interface ExecutionLimits {
	maxModelRequests: number;
	maxToolExecutions: number;
	maxActiveSeconds: number;
	toolTimeoutSeconds: number;
	maxToolOutputBytes: number;
	maxTokenReservations: number;
	maxConcurrentRuns: number;
	maxConcurrentModelCalls: number;
	maxChildren: number;
	maxMessages: number;
	maxMessageBytes: number;
	maxArtifactBytes: number;
	artifactTtlSeconds: number;
}

export interface ExecutionSettings {
	version: number;
	enabled: boolean;
	limits: ExecutionLimits;
	hardLimits: ExecutionLimits;

	updatedAt: number;
}

export interface ExecutionActor {
	userId: number;
	token: string;
}

export interface HardLimitPreview {
	id: string;
	expectedVersion: number;
	expiresAt: number;
	proposed: ExecutionLimits;
	occupiedArtifactBytes: number;
	activeRuns: number;
}

export interface ExecutionFacts {
	identityUserId: number | null;
	settings: ExecutionSettings | null;
	occupiedArtifactBytes: number;
	activeRuns: number;
}

export interface ExecutionUsage {
	rootId: string;
	modelRequests: number;
	toolExecutions: number;
	reservedTokens: number;
	concurrentModelCalls: number;
}

export function copyExecutionLimits(value: ExecutionLimits): ExecutionLimits {
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
		maxArtifactBytes: value.maxArtifactBytes,
		artifactTtlSeconds: value.artifactTtlSeconds,
	};
}
