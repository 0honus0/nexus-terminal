/** Persisted tool attempts and chat tool records use these exact state values. */
export const AGENT_TOOL_STATES = ['inspected', 'dispatched', 'completed', 'failed', 'unknown', 'cancelled'] as const;

export type AgentToolState = (typeof AGENT_TOOL_STATES)[number];

export const AGENT_TOOL_LIST_DEFAULT_LIMIT = 60;

export const AGENT_TOOL_LIST_MAX_LIMIT = 100;

export const AGENT_TOOL_MAX_RESPONSE_BYTES = 128 * 1024;

/** Same existing bound as persisted model-proposed arguments. */
export const AGENT_TOOL_ARGUMENT_MAX_BYTES = 16 * 1024;
