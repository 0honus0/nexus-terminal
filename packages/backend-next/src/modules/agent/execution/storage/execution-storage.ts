import type { AgentCompactionMode, AgentContextProfile } from '@nexus-terminal/shared/agent/governance/values';
import type { AgentChildProfile } from '@nexus-terminal/shared/agent/collaboration/values';

export interface StoredExecutionLimits {
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

export type StoredProfileModel =
	{ kind: 'inherit' } | { kind: 'explicit'; providerId: string; modelId: string; configurationVersion: number };

export interface StoredExecutionProfile {
	name: AgentChildProfile;
	enabled: boolean;
	model: StoredProfileModel;
	maxRequests: number;
	maxSeconds: number;
	tools: string[];
}

export interface StoredExecutionSettings {
	contextCompactionMode: AgentCompactionMode;
	contextProfile: AgentContextProfile;
	version: number;
	enabled: boolean;
	limits: StoredExecutionLimits;
	hardLimits: StoredExecutionLimits;
	profiles: StoredExecutionProfile[];
	updatedAt: number;
}

export interface StoredExecutionActor {
	userId: number;
	digest: string;
}

export interface StoredHardLimitPreview {
	id: string;
	expectedVersion: number;
	expiresAt: number;
	proposed: StoredExecutionLimits;
	occupiedArtifactBytes: number;
	activeRuns: number;
}

export interface StoredExecutionFacts {
	identityUserId: number | null;
	settings: StoredExecutionSettings | null;
	occupiedArtifactBytes: number;
	activeRuns: number;
}

export class ExecutionStorageRefusal extends Error {
	constructor(readonly code: 'not_found' | 'version_conflict') {
		super(code);
	}
}

export interface ExecutionStorage {
	frozen(userId: number, appId: string, runId: string): Promise<StoredExecutionSettings | null>;
	get(userId: number): Promise<StoredExecutionSettings | null>;
	update(
		actor: StoredExecutionActor,
		expectedVersion: number,
		decide: (facts: StoredExecutionFacts) => StoredExecutionSettings,
	): Promise<StoredExecutionSettings>;
	preview(
		actor: StoredExecutionActor,
		id: string,
		expiresAt: number,
		now: number,
		decide: (facts: StoredExecutionFacts, confirmations: number) => StoredHardLimitPreview,
	): Promise<StoredHardLimitPreview>;
	confirm(
		actor: StoredExecutionActor,
		id: string,
		now: number,
		decide: (facts: StoredExecutionFacts, preview: StoredHardLimitPreview) => StoredExecutionSettings,
	): Promise<StoredExecutionSettings>;
}

export interface StoredExecutionUsage {
	rootId: string;
	modelRequests: number;
	toolExecutions: number;
	reservedTokens: number;
	concurrentModelCalls: number;
}
