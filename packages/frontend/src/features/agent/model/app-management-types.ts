import type { AgentAppExecutionState } from '@nexus-terminal/shared/agent/scope/values';
import type { AgentCapability, AgentGrantScopeKind } from '@nexus-terminal/shared/agent/governance/values';

export interface ManagedApp {
	id: string;
	name: string;
	definitionId: string;
	definitionVersion: string;
	capabilities: AgentCapability[];
	enabled: boolean;
	version: number;
	executionState: AgentAppExecutionState;
	createdAt: number;
	updatedAt: number;
}

export type AppGrantScope =
	{ kind: 'global' } | { kind: 'targets'; ssh: null | { mode: 'all' } | { mode: 'ids'; ids: string[] } };

export interface AppGrantInput {
	capability: AgentCapability;
	scope: AppGrantScope;
}

export interface AppGrants {
	appId: string;
	revision: number;
	definitions: { id: AgentCapability; scopeKind: AgentGrantScopeKind; defaultScope: AppGrantScope }[];
	grants: { capability: AgentCapability; scope: AppGrantScope; grantedAt: number }[];
}

export interface AppPolicyOverrides {
	maxModelRequests?: number;
	maxActiveExecutionSeconds?: number;
	toolTimeoutSeconds?: number;
	maxToolOutputBytes?: number;
	maxSubagentMessages?: number;
	maxSubagentMessageBytes?: number;
}

export interface AppExecutionPolicy {
	version: number;
	overrides: AppPolicyOverrides;
	effective: Required<AppPolicyOverrides>;
}

export interface AgentDenylist {
	revision: number;
	entries: { connectionId: number; reason: string; changedBy: number; changedAt: number }[];
}

export interface AgentDenylistDraft {
	connectionIds: number[];
	reason: string;
}
