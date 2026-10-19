export const AGENT_INTEGRATION_KINDS = ['mcp', 'acp'] as const;

export type AgentIntegrationKind = (typeof AGENT_INTEGRATION_KINDS)[number];

export const AGENT_INTEGRATION_MAX_BODY_BYTES = 32 * 1024;

export const AGENT_INTEGRATION_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export const AGENT_INTEGRATION_MAX_ITEMS = 128;

export const AGENT_INTEGRATION_NAME_MAX_BYTES = 128;

export const AGENT_MCP_ENDPOINT_MAX_BYTES = 4096;

export const AGENT_MCP_HOST_MAX_ITEMS = 32;

export const AGENT_MCP_HOST_MAX_BYTES = 253;

export const AGENT_ACP_ARGV_MAX_ITEMS = 128;

export const AGENT_ACP_ARGV_MAX_BYTES = 8192;

export const AGENT_ACP_CWD_MAX_BYTES = 256;

export const AGENT_MCP_PROTOCOL_VERSION = '2026-07-28';
