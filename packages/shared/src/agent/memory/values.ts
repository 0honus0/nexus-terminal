export const AGENT_MEMORY_STATUSES = ['candidate', 'published', 'revoked'] as const;

export type AgentMemoryStatus = (typeof AGENT_MEMORY_STATUSES)[number];

export const AGENT_MEMORY_DECISIONS = ['publish', 'reject', 'revoke'] as const;

export type AgentMemoryDecision = (typeof AGENT_MEMORY_DECISIONS)[number];

export const AGENT_MEMORY_MAX_CONTENT_BYTES = 16 * 1024;

export const AGENT_MEMORY_MAX_PAGE = 50;

export const AGENT_MEMORY_MAX_OFFSET = Number.MAX_SAFE_INTEGER - AGENT_MEMORY_MAX_PAGE;

export const AGENT_MEMORY_MAX_BODY_BYTES = 128 * 1024;

export const AGENT_MEMORY_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
