import type { AgentChildProfile } from '../collaboration/values.js';

export interface AgentExecutionLimits {
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

export type AgentProfileModel =
	{ kind: 'inherit' } | { kind: 'explicit'; providerId: string; modelId: string; configurationVersion: number };

export interface AgentExecutionProfile {
	name: AgentChildProfile;
	enabled: boolean;
	model: AgentProfileModel;
	maxRequests: number;
	maxSeconds: number;
	tools: string[];
}

export interface AgentExecutionSettingsView {
	version: number;
	enabled: boolean;
	limits: AgentExecutionLimits;
	hardLimits: AgentExecutionLimits;
	profiles: AgentExecutionProfile[];
	updatedAt: number;
}

export interface AgentHardLimitPreviewView {
	id: string;
	expectedVersion: number;
	expiresAt: number;
	proposed: AgentExecutionLimits;
	occupiedArtifactBytes: number;
	activeRuns: number;
}
