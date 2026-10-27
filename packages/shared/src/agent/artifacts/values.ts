import { AGENT_EXECUTION_LIMIT_MAXIMA } from '../execution/values.js';

export const AGENT_ARTIFACT_STATUSES = ['staging', 'ready', 'deleting', 'deleted', 'unavailable'] as const;

export type AgentArtifactStatus = (typeof AGENT_ARTIFACT_STATUSES)[number];

export const AGENT_ARTIFACT_MAX_BYTES = AGENT_EXECUTION_LIMIT_MAXIMA.maxArtifactBytes;

export const AGENT_ARTIFACT_MAX_PAGE = 50;

export const AGENT_ARTIFACT_MAX_OFFSET = Number.MAX_SAFE_INTEGER - AGENT_ARTIFACT_MAX_PAGE;

export const AGENT_ARTIFACT_MAX_BODY_BYTES = 16 * 1024;

export const AGENT_ARTIFACT_MAX_RESPONSE_BYTES = 128 * 1024;

export const AGENT_ARTIFACT_CONTENT_TYPES = ['image', 'document', 'code', 'archive', 'media', 'other'] as const;

export type AgentArtifactKind = (typeof AGENT_ARTIFACT_CONTENT_TYPES)[number];

export const AGENT_ARTIFACT_MAX_CLEANUP_ITEMS = 128;
