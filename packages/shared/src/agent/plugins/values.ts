import { AGENT_APP_MAX_RESPONSE_BYTES } from '../scope/values.js';
import { AGENT_GOVERNANCE_MAX_RESPONSE_BYTES } from '../governance/values.js';

export const AGENT_PLUGIN_MAX_BODY_BYTES = 256 * 1024;

export const AGENT_PLUGIN_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export const AGENT_PLUGIN_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

export const AGENT_PLUGIN_MAX_EXPANDED_BYTES = 200 * 1024 * 1024;

export const AGENT_PLUGIN_MAX_ASSET_BYTES = 16 * 1024 * 1024;

export const AGENT_PLUGIN_MAX_ENTRY_BYTES = 2048;

export const AGENT_PLUGIN_MAX_MESSAGE_BYTES = 512 * 1024;

export const AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES =
	Math.max(AGENT_APP_MAX_RESPONSE_BYTES, AGENT_GOVERNANCE_MAX_RESPONSE_BYTES) + 1024;

export const AGENT_PLUGIN_RPC_TIMEOUT_MS = 30000;

export const AGENT_PLUGIN_MAX_MIGRATION_KEYS = 1024;

/** 8 MiB of persisted JSON strings can expand sixfold in the surrounding wire JSON. */
export const AGENT_PLUGIN_MAX_MIGRATION_BYTES = 52 * 1024 * 1024;

export const AGENT_PLUGIN_STAGE_STATUSES = ['staging', 'staged', 'verified', 'installed', 'failed'] as const;

export type AgentPluginStageStatus = (typeof AGENT_PLUGIN_STAGE_STATUSES)[number];

export const AGENT_PLUGIN_INSTALLATION_STATUSES = ['installed', 'draining', 'removed'] as const;

export type AgentPluginInstallationStatus = (typeof AGENT_PLUGIN_INSTALLATION_STATUSES)[number];

export const AGENT_PLUGIN_MAX_DATA_KEY_BYTES = 128;

export const AGENT_PLUGIN_MAX_DATA_VALUE_BYTES = 128 * 1024;

export const AGENT_PLUGIN_MAX_CATALOG_BYTES = 8 * 1024 * 1024;

export const AGENT_PLUGIN_MAX_REPOSITORIES = 16;

export const AGENT_PLUGIN_VERSION_PATTERN =
	/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[a-z-][a-z0-9-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[a-z-][a-z0-9-]*))*)?$/u;
