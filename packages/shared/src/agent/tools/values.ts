import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES } from '../plugins/values.js';
import { AGENT_PLUGIN_CONTENT_CHUNK_BYTES } from '../plugins/content.js';

/** Persisted tool attempts and chat tool records use these exact state values. */
export const AGENT_TOOL_STATES = ['inspected', 'dispatched', 'completed', 'failed', 'unknown', 'cancelled'] as const;

export type AgentToolState = (typeof AGENT_TOOL_STATES)[number];

export const AGENT_TOOL_JOB_STATES = ['queued', 'dispatched', 'completed', 'failed', 'unknown'] as const;

export type AgentToolJobState = (typeof AGENT_TOOL_JOB_STATES)[number];

export const AGENT_TOOL_LIST_DEFAULT_LIMIT = 60;

export const AGENT_TOOL_LIST_MAX_LIMIT = 100;

/** Arguments travel through the existing plugin envelope; no smaller model-tool policy. */
export const AGENT_TOOL_ARGUMENT_MAX_BYTES = AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES;

/** Detail responses contain JSON text, which can expand sixfold when encoded. */
export const AGENT_TOOL_MAX_RESPONSE_BYTES = AGENT_TOOL_ARGUMENT_MAX_BYTES * 6 + 128 * 1024;

/** Existing durable model-visible tool result budget, also consumed by independently delivered tool batches. */
export const AGENT_TOOL_RESULT_MAX_BYTES = 256 * 1024;

/** Match the existing content chunk transport, including worst-case JSON escaping. */
export const AGENT_TOOL_RESULT_PAGE_MAX_BYTES = AGENT_PLUGIN_CONTENT_CHUNK_BYTES;
