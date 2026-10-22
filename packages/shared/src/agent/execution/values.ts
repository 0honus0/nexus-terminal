export const AGENT_EXECUTION_LIMIT_KEYS = [
	'maxModelRequests',
	'maxToolExecutions',
	'maxActiveSeconds',
	'toolTimeoutSeconds',
	'maxToolOutputBytes',
	'maxTokenReservations',
	'maxConcurrentRuns',
	'maxConcurrentModelCalls',
	'maxChildren',
	'maxMessages',
	'maxMessageBytes',
	'maxRecallItems',
	'maxRecallBytes',
	'maxSingleArtifactBytes',
	'maxArtifactBytes',
	'artifactTtlSeconds',
] as const;

export type AgentExecutionLimitKey = (typeof AGENT_EXECUTION_LIMIT_KEYS)[number];

export const AGENT_EXECUTION_LIMIT_MAXIMA = {
	maxModelRequests: 160,
	maxToolExecutions: 1280,
	maxActiveSeconds: 7200,
	toolTimeoutSeconds: 300,
	maxToolOutputBytes: 262144,
	maxTokenReservations: 8000000,
	maxConcurrentRuns: 8,
	maxConcurrentModelCalls: 8,
	maxChildren: 4,
	maxMessages: 5000,
	maxMessageBytes: 8388608,
	maxRecallItems: 20,
	maxRecallBytes: 32768,
	maxSingleArtifactBytes: 16777216,
	maxArtifactBytes: 10737418240,
	artifactTtlSeconds: 2592000,
} as const;

export const AGENT_EXECUTION_SETTINGS_MAX_BYTES = 128 * 1024;
