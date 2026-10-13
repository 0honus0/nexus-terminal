import type {
	AgentApprovalStatus,
	AgentApprovalKind,
	AgentApprovalRisk,
	AgentGrantScopeKind,
	AgentCompactionMode,
	AgentContextProfile,
	AgentCapability,
} from './values.js';

export type AgentGrantScope =
	{ kind: 'global' } | { kind: 'targets'; targets: { ssh?: { mode: 'all' } | { mode: 'ids'; ids: string[] } } };

export interface AgentGrant {
	capability: AgentCapability;
	schemaVersion: 2;
	scope: AgentGrantScope;
	grantedAt: number;
}

export interface AgentCapabilityDefinition {
	id: AgentCapability;
	scopeKind: AgentGrantScopeKind;
	supportedTargets: 'ssh'[];
	defaultScope: AgentGrantScope;
}

export interface AgentGrantView {
	appId: string;
	policyRevision: number;
	definitions: AgentCapabilityDefinition[];
	grants: AgentGrant[];
}

export interface AgentExecutionPolicyOverrides {
	maxModelRequests?: number;
	maxAutoModelRequests?: number;
	maxAutoActiveExecutionSeconds?: number;
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

export interface AgentExecutionPolicyView {
	overrides: AgentExecutionPolicyOverrides;
	effective: Required<AgentExecutionPolicyOverrides>;
	version: number;
}

export interface AgentApprovalView {
	id: string;
	appId: string;
	runId: string;
	toolCallId: string;
	operationHash: string;
	kind: AgentApprovalKind;
	status: AgentApprovalStatus;
	policyRevision: number;
	inputRevision: number;
	version: number;
	requestedAt: number;
	expiresAt: number;
	decidedAt: number | null;
	decidedByUserId: number | null;
	consumedAt: number | null;
	inspection: {
		toolName: string;
		toolVersion: string;
		risk: AgentApprovalRisk;
		mutation: boolean;
		targetConnectionId: number | null;
		summary: string;
	};
}
