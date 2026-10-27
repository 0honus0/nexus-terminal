import { AGENT_EXECUTION_LIMIT_MAXIMA } from '../execution/values.js';

/** Each Child consumes a family tool operation; history cannot exceed that budget. */
export const AGENT_CHILD_MAX_LIST = AGENT_EXECUTION_LIMIT_MAXIMA.maxToolExecutions;

export const AGENT_COLLABORATION_MESSAGE_MAX_PAGE = 32;

export const AGENT_COLLABORATION_MAX_RESPONSE_BYTES = AGENT_CHILD_MAX_LIST * 512 + 16 * 1024;

export const AGENT_CHILD_PROFILES = ['explore', 'review', 'worker'] as const;

export type AgentChildProfile = (typeof AGENT_CHILD_PROFILES)[number];

export const AGENT_MESSAGE_METADATA_MAX_BODY_BYTES = 8 * 1024;
