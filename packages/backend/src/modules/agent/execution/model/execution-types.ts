import type { AgentCompactionMode, AgentContextProfile } from '@nexus-terminal/shared/agent/governance/values';
import type { AgentChildProfile } from '@nexus-terminal/shared/agent/collaboration/values';

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
	maxRecallItems: number;
	maxRecallBytes: number;
	maxSingleArtifactBytes: number;
	maxArtifactBytes: number;
	artifactTtlSeconds: number;
}

export type ProfileModel =
	{ kind: 'inherit' } | { kind: 'explicit'; providerId: string; modelId: string; configurationVersion: number };

export interface ExecutionProfile {
	name: AgentChildProfile;
	enabled: boolean;
	model: ProfileModel;
	maxRequests: number;
	maxSeconds: number;
	tools: string[];
}

export interface ExecutionSettings {
	contextCompactionMode: AgentCompactionMode;
	contextProfile: AgentContextProfile;
	version: number;
	enabled: boolean;
	limits: ExecutionLimits;
	hardLimits: ExecutionLimits;
	profiles: ExecutionProfile[];
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

export type ExecutionBudgetAdmission = (settings: ExecutionSettings, usage: ExecutionUsage) => void;

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
		maxRecallItems: value.maxRecallItems,
		maxRecallBytes: value.maxRecallBytes,
		maxSingleArtifactBytes: value.maxSingleArtifactBytes,
		maxArtifactBytes: value.maxArtifactBytes,
		artifactTtlSeconds: value.artifactTtlSeconds,
	};
}
