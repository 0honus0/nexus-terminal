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
	'maxArtifactBytes',
	'artifactTtlSeconds',
] as const;

export type AgentExecutionLimitKey = (typeof AGENT_EXECUTION_LIMIT_KEYS)[number];

/** Node timers and the SSH command API use a signed 32-bit millisecond delay. */
export const AGENT_EXECUTION_MAX_TIMER_SECONDS = Math.floor((2 ** 31 - 1) / 1000);

/** ECMAScript Date TimeClip representation, not an Artifact retention policy. */
export const AGENT_EXECUTION_MAX_EXPIRY_MS = 8_640_000_000_000_000;

/** Representation bounds only. Saved hard limits and budgets own execution policy. */
export const AGENT_EXECUTION_LIMIT_MAXIMA = {
	maxModelRequests: Number.MAX_SAFE_INTEGER,
	maxToolExecutions: Number.MAX_SAFE_INTEGER,
	maxActiveSeconds: AGENT_EXECUTION_MAX_TIMER_SECONDS,
	toolTimeoutSeconds: AGENT_EXECUTION_MAX_TIMER_SECONDS,
	maxToolOutputBytes: Number.MAX_SAFE_INTEGER,
	maxTokenReservations: Number.MAX_SAFE_INTEGER,
	maxConcurrentRuns: Number.MAX_SAFE_INTEGER,
	maxConcurrentModelCalls: Number.MAX_SAFE_INTEGER,
	maxChildren: Number.MAX_SAFE_INTEGER,
	maxMessages: Number.MAX_SAFE_INTEGER,
	maxMessageBytes: Number.MAX_SAFE_INTEGER,
	maxRecallItems: Number.MAX_SAFE_INTEGER,
	maxRecallBytes: Number.MAX_SAFE_INTEGER,
	maxArtifactBytes: Number.MAX_SAFE_INTEGER,
	artifactTtlSeconds: Math.floor(AGENT_EXECUTION_MAX_EXPIRY_MS / 1000),
} as const;

export const AGENT_EXECUTION_SETTINGS_MAX_BYTES = 128 * 1024;
