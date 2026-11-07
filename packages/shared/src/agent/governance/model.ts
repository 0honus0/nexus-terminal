import type { AgentApprovalStatus, AgentApprovalRisk, AgentGrantScopeKind, AgentCapability } from './values.js';

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
	maxActiveExecutionSeconds?: number;
	toolTimeoutSeconds?: number;
	maxToolOutputBytes?: number;
	maxRecallItems?: number;
	maxRecallBytes?: number;
	maxSubagentMessages?: number;
	maxSubagentMessageBytes?: number;
}

export interface AgentExecutionPolicyView {
	overrides: AgentExecutionPolicyOverrides;
	effective: Required<AgentExecutionPolicyOverrides>;
	version: number;
}

export interface AgentApprovalView {
	id: string;
	sequence: number;
	appId: string;
	runId: string;
	operationId: string;
	parentOperationId: string | null;
	operationHash: string;
	status: AgentApprovalStatus;
	policyRevision: number;
	version: number;
	capability: AgentCapability;
	operationName: string;
	risk: AgentApprovalRisk;
	summary: string;
	targetId: number | null;
	requestedAt: number;
	expiresAt: number;
	decidedAt: number | null;
	decidedByUserId: number | null;
	consumedAt: number | null;
}

export interface AgentTargetDenylistView {
	revision: number;
	/** changedAt is Unix seconds; backend persistence retains millisecond precision. */
	entries: { connectionId: number; reason: string; changedBy: number; changedAt: number }[];
}

export interface AgentApprovalPage {
	items: AgentApprovalView[];
	after: string | null;
	nextCursor: string | null;
	hasMore: boolean;
}
