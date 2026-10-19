/** Backend-only durable job state; a dispatch intent does not assert process health. */
export const TOOL_JOB_STATES = ['queued', 'dispatched', 'completed', 'failed', 'unknown'] as const;

export type ToolJobState = (typeof TOOL_JOB_STATES)[number];
