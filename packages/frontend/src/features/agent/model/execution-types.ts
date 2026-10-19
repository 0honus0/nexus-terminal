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

export type ExecutionModel =
	{ kind: 'inherit' } | { kind: 'explicit'; providerId: string; modelId: string; configurationVersion: number };

export interface ExecutionProfileDraft {
	name: AgentChildProfile;
	enabled: boolean;
	model: ExecutionModel;
	maxRequests: number;
	maxSeconds: number;
	toolsText: string;
}

export interface ExecutionSettings {
	version: number;
	enabled: boolean;
	limits: ExecutionLimits;
	hardLimits: ExecutionLimits;
	profiles: ExecutionProfileDraft[];
	updatedAt: number;
}

export interface HardLimitConfirmation {
	id: string;
	expectedVersion: number;
	expiresAt: number;
	proposed: ExecutionLimits;
	occupiedArtifactBytes: number;
	activeRuns: number;
}

export interface ExecutionModelChoice {
	key: string;
	label: string;
	providerId: string;
	modelId: string;
	configurationVersion: number;
}
