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

export interface HardLimitConfirmation {
	id: string;
	expectedVersion: number;
	expiresAt: number;
	proposed: ExecutionLimits;
	occupiedArtifactBytes: number;
	activeRuns: number;
}
