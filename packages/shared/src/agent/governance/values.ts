/** Capability IDs used by the installed Agent governance HTTP endpoints. */
export const AGENT_CAPABILITIES = [
	'file.read',
	'file.write',
	'file.delete',
	'machine.inspect',
	'shell.execute',
	'machine.docker.manage',
	'browser.read',
	'browser.interact',
	'integration.mcp.read',
	'integration.mcp.invoke',
	'integration.acp.invoke',
	'artifacts.read',
	'app.intents.exchange',
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export const AGENT_GRANT_SCOPE_KINDS = ['global', 'targets'] as const;

export type AgentGrantScopeKind = (typeof AGENT_GRANT_SCOPE_KINDS)[number];

export const AGENT_TARGET_CAPABILITIES: readonly AgentCapability[] = [
	'file.read',
	'file.write',
	'file.delete',
	'shell.execute',
];

export const AGENT_APPROVAL_STATUSES = ['requested', 'approved', 'denied', 'expired', 'superseded'] as const;

export type AgentApprovalStatus = (typeof AGENT_APPROVAL_STATUSES)[number];

export const AGENT_APPROVAL_KINDS = ['tool', 'acp_permission'] as const;

export type AgentApprovalKind = (typeof AGENT_APPROVAL_KINDS)[number];

export const AGENT_APPROVAL_RISKS = ['read', 'control', 'mutate', 'destructive', 'forbidden'] as const;

export type AgentApprovalRisk = (typeof AGENT_APPROVAL_RISKS)[number];

export const AGENT_APPROVAL_DECISIONS = ['approved', 'denied'] as const;

export type AgentApprovalDecision = (typeof AGENT_APPROVAL_DECISIONS)[number];

export const AGENT_APPROVAL_TTL_SECONDS = 600;

/** A list must fail rather than truncate when this complete-result budget is exceeded. */
export const AGENT_APPROVAL_MAX_LIST_ITEMS = 1024;

export const AGENT_GRANT_MAX_TARGET_IDS = 256;

export const AGENT_GRANT_MAX_ID_BYTES = 128;

export const AGENT_GOVERNANCE_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export const AGENT_GOVERNANCE_MAX_BODY_BYTES = 16 * 1024;

export const AGENT_GOVERNANCE_MAX_GRANT_BODY_BYTES = 512 * 1024;

export const AGENT_EXECUTION_COMPACTION_MODES = ['aggressive', 'balanced', 'conservative'] as const;

export type AgentCompactionMode = (typeof AGENT_EXECUTION_COMPACTION_MODES)[number];

export const AGENT_EXECUTION_CONTEXT_PROFILES = ['normal', 'extended'] as const;

export type AgentContextProfile = (typeof AGENT_EXECUTION_CONTEXT_PROFILES)[number];

export const AGENT_EXECUTION_INTEGER_KEYS = [
	'maxModelRequests',
	'maxAutoModelRequests',
	'maxAutoActiveExecutionSeconds',
	'maxActiveExecutionSeconds',
	'toolTimeoutSeconds',
	'maxToolOutputBytes',
	'maxRecallItems',
	'maxRecallBytes',
	'maxSubagentMessages',
	'maxSubagentMessageBytes',
] as const;

export const AGENT_APPROVAL_MAX_TOOL_NAME_BYTES = 256;

export const AGENT_APPROVAL_MAX_TOOL_VERSION_BYTES = 256;

export const AGENT_APPROVAL_MAX_SUMMARY_BYTES = 2048;

export const AGENT_APPROVAL_MAX_FEEDBACK_BYTES = 2000;

export const AGENT_APPROVAL_OPERATION_HASH_LENGTH = 64;

export const AGENT_APPROVAL_OPERATION_HASH_PATTERN = /^[a-f0-9]{64}$/iu;
