import { AGENT_GOVERNANCE_MAX_RESPONSE_BYTES } from '../governance/values.js';
import { AGENT_THREAD_ENTRIES_MAX_RESPONSE_BYTES } from '../scope/values.js';
import { AGENT_COLLABORATION_MAX_RESPONSE_BYTES } from '../collaboration/values.js';
import { AGENT_MAX_RESPONSE_BYTES } from '../values.js';

export const AGENT_APPROVAL_MODES = ['ask', 'full_access'] as const;

export type AgentApprovalMode = (typeof AGENT_APPROVAL_MODES)[number];

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

/** Safe user-facing tool failure reasons; raw exceptions never enter the protocol. */
export const AGENT_RUN_FAILURE_CODES = [
	'execution_not_authorized',
	'execution_failed',
	'execution_storage_failed',
	'execution_limit_exceeded',
	'context_limit_exceeded',
	'configuration_changed',
	'tool_capability_missing',
	'tool_target_denied',
	'tool_app_disabled',
	'tool_capability_undeclared',
	'tool_not_authorized',
	'tool_timeout',
	'tool_invalid_input',
	'tool_target_unavailable',
	'tool_resource_not_found',
	'tool_remote_permission_denied',
	'tool_host_untrusted',
	'tool_command_failed',
	'tool_limit_exceeded',
	'tool_state_changed',
	'tool_approval_expired',
	'tool_failed',
	'model_auth_failed',
	'model_rate_limited',
	'model_request_rejected',
	'model_not_found',
	'model_service_unavailable',
	'model_output_limit',
	'model_content_filtered',
	'model_response_too_large',
	'model_cleanup_failed',
	'model_timeout',
	'model_response_invalid',
	'model_dns_failed',
	'model_tls_failed',
	'model_response_empty',
	'model_stream_truncated',
	'model_network_failed',
	'model_failed',
] as const;

export type AgentRunFailureCode = (typeof AGENT_RUN_FAILURE_CODES)[number];
