import type { AgentAppExecutionState } from '@nexus-terminal/shared/agent/scope/values';
import type {
	AgentCapability,
	AgentGrantScopeKind,
	AgentCompactionMode,
	AgentContextProfile,
} from '@nexus-terminal/shared/agent/governance/values';

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

export interface AppDefinition {
	id: string;
	version: string;
	name: string;
	capabilities: AgentCapability[];
	defaultEnabled: boolean;
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
	maxRecallItems?: number;
	maxRecallBytes?: number;
	maxSubagentMessages?: number;
	maxSubagentMessageBytes?: number;
	contextCompactionMode?: AgentCompactionMode;
	contextProfile?: AgentContextProfile;
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
