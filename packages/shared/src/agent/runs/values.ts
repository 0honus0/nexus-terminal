export const AGENT_RUN_STATUSES = ['pending', 'cancelled'] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_RUN_EVENT_TYPES = ['run.created', 'run.cancelled'] as const;

export type AgentRunEventType = (typeof AGENT_RUN_EVENT_TYPES)[number];

export type AgentCreateRunOutcome = 'created';

export type AgentCancelRunOutcome = 'cancelled' | 'already_cancelled';

export type AgentRunCommandOutcome = AgentCreateRunOutcome | AgentCancelRunOutcome;

export const AGENT_RUN_MAX_PROMPT_BYTES = 16 * 1024;

export const AGENT_RUN_MAX_JSON_BODY_BYTES = 128 * 1024;

export const AGENT_RUN_EVENT_DEFAULT_AFTER = 0;

export const AGENT_RUN_EVENT_DEFAULT_LIMIT = 50;

export const AGENT_RUN_EVENT_MAX_LIMIT = 100;

export const AGENT_RUN_IDEMPOTENCY_HEADER = 'Idempotency-Key';
