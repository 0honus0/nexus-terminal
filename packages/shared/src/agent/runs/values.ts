import { AGENT_GOVERNANCE_MAX_RESPONSE_BYTES } from '../governance/values.js';
import { AGENT_THREAD_ENTRIES_MAX_RESPONSE_BYTES } from '../scope/values.js';
import { AGENT_COLLABORATION_MAX_RESPONSE_BYTES } from '../collaboration/values.js';
import { AGENT_MAX_RESPONSE_BYTES } from '../values.js';

export const AGENT_RUN_STATUSES = ['pending', 'running', 'completed', 'failed', 'unknown', 'cancelled'] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_RUN_EVENT_TYPES = [
	'run.created',
	'run.started',
	'run.completed',
	'run.failed',
	'run.unknown',
	'run.cancelled',
] as const;

export type AgentRunEventType = (typeof AGENT_RUN_EVENT_TYPES)[number];

export type AgentCreateRunOutcome = 'created';

export type AgentCancelRunOutcome = 'cancelled' | 'already_cancelled';

export type AgentRunCommandOutcome = AgentCreateRunOutcome | AgentCancelRunOutcome;

export const AGENT_RUN_MAX_PROMPT_BYTES = 16 * 1024;

export const AGENT_RUN_MAX_SELECTED_CONNECTIONS = 50;

export const AGENT_RUN_MAX_JSON_BODY_BYTES = 128 * 1024;

export const AGENT_RUN_EVENT_DEFAULT_AFTER = 0;

export const AGENT_RUN_EVENT_DEFAULT_LIMIT = 50;

export const AGENT_RUN_EVENT_MAX_LIMIT = 100;

export const AGENT_RUN_IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** Public audit byte counters use the same bound as the durable model-step output. */
export const AGENT_RUN_STEP_MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** Journal capacity, not an authorization or per-Run execution budget. */
export const AGENT_RUN_STEP_MAX_COUNT = 400;

export const AGENT_RUN_STEP_FINISH_REASONS = ['stop', 'tool_calls'] as const;

export type AgentRunStepFinishReason = (typeof AGENT_RUN_STEP_FINISH_REASONS)[number];

export const AGENT_RUN_STEP_STATES = ['reserved', 'dispatched', 'completed', 'failed', 'unknown'] as const;

export type AgentRunStepState = (typeof AGENT_RUN_STEP_STATES)[number];

export const AGENT_RUN_STEP_EVENT_TYPES = [
	'text.delta',
	'usage',
	'step.completed',
	'step.failed',
	'step.unknown',
] as const;

export type AgentRunStepEventType = (typeof AGENT_RUN_STEP_EVENT_TYPES)[number];

export type AgentRunStepFailureCode = 'DISPATCH_NOT_STARTED';

export const AGENT_RUN_STREAM_MAX_COMMAND_BYTES = 1024;

export const AGENT_RUN_STREAM_MAX_JSON_BYTES =
	AGENT_GOVERNANCE_MAX_RESPONSE_BYTES +
	AGENT_THREAD_ENTRIES_MAX_RESPONSE_BYTES +
	AGENT_COLLABORATION_MAX_RESPONSE_BYTES +
	AGENT_MAX_RESPONSE_BYTES +
	8192;

export const AGENT_RUN_STREAM_MAX_IN_FLIGHT_PAGES = 16;
