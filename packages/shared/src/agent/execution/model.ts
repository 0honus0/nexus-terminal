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
	maxArtifactBytes: number;
	artifactTtlSeconds: number;
}

export interface AgentExecutionSettingsView {
	version: number;
	enabled: boolean;
	limits: AgentExecutionLimits;
	hardLimits: AgentExecutionLimits;

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
