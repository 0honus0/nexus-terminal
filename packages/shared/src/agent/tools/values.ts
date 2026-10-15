/** Persisted tool attempts and the public audit use these exact state values. */
export const AGENT_TOOL_STATES = ['inspected', 'dispatched', 'completed', 'failed', 'unknown', 'cancelled'] as const;

export type AgentToolState = (typeof AGENT_TOOL_STATES)[number];

export const AGENT_TOOL_EVENT_MAX_LIMIT = 100;

export const AGENT_TOOL_MAX_RESPONSE_BYTES = 128 * 1024;
