import type { AgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity';
import type { ExecutionSettings } from '../../execution/model/execution-types.js';

/** Advisory model catalog; actual dispatch always rechecks tool authority. */
export interface ToolCatalogState {
	capabilities: AgentCapability[];
	connectionIds: number[];
}

export interface ToolCatalogFacts {
	policy: GrantState;
	policyExecutionVersion: number;
	connectionIds: number[];
	denylistRevision: number;
}

import type {
	AgentCapability,
	AgentApprovalStatus,
	AgentApprovalKind,
	AgentApprovalRisk,
} from '@nexus-terminal/shared/agent/governance/values';

export type GrantScope =
	{ kind: 'global' } | { kind: 'targets'; targets: { ssh?: { mode: 'all' } | { mode: 'ids'; ids: string[] } } };

export interface Grant {
	capability: AgentCapability;
	schemaVersion: 2;
	scope: GrantScope;
	grantedAt: number;
}

export interface GrantInput {
	capability: AgentCapability;
	scope: GrantScope;
}

export interface GrantState {
	app: AppPolicyFacts;
	appId: string;
	userId: number;
	revision: number;
	grants: Grant[];
}

export type PolicyOverrides = {
	maxModelRequests?: number;
	maxActiveExecutionSeconds?: number;
	toolTimeoutSeconds?: number;
	maxToolOutputBytes?: number;
	maxRecallItems?: number;
	maxRecallBytes?: number;
	maxSubagentMessages?: number;
	maxSubagentMessageBytes?: number;
};

export interface ExecutionPolicy {
	version: number;
	overrides: PolicyOverrides;
	effective: Required<PolicyOverrides>;
}

export interface AuthorizationFact {
	userId: number;
	appId: string;
	capability: AgentCapability;
	connectionId: number | null;
	revision: number;
	allowed: boolean;
}

export interface ApprovalInspection {
	toolName: string;
	toolVersion: string;
	identity: AgentToolIdentity;
	risk: AgentApprovalRisk;
	mutation: boolean;
	targetConnectionId: number | null;
	summary: string;
}

export interface Approval {
	targetVersion: number | null;
	capability: AgentCapability;
	id: string;
	userId: number;
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
	feedback: string | null;
	inspection: ApprovalInspection;
}

export interface ExecutionPolicyFacts {
	settings: ExecutionSettings | null;
	app: AppPolicyFacts;
	version: number;
	overrides: PolicyOverrides;
}

export type GrantChangeDecision = (current: GrantState) => { allow: boolean; pendingStatus: 'superseded' | null };

export type ExecutionChangeDecision = (current: ExecutionPolicyFacts) => {
	allow: boolean;
	pendingStatus: 'superseded' | null;
};

export interface CapabilityDefinition {
	id: AgentCapability;
	scopeKind: 'global' | 'targets';
	supportedTargets: 'ssh'[];
	defaultScope: GrantScope;
}

export interface GrantCatalogState {
	appId: string;
	userId: number;
	revision: number;
	grants: Grant[];
	definitions: CapabilityDefinition[];
}

export interface AppPolicyFacts {
	enabled: boolean;
	declared: boolean;
	capabilities: AgentCapability[];
	deniedTargetIds: number[];
}

export interface TargetDenylist {
	revision: number;
	entries: { connectionId: number; reason: string; changedBy: number; changedAt: number }[];
}

export interface DenylistCommand {
	userId: number;
	expectedRevision: number;
	connectionIds: number[];
	reason: string;
}

export interface DenylistTarget {
	id: number;
	version: number;
}

export type DenylistChangeDecision = (current: TargetDenylist) => { revoke: boolean };

export interface DenylistMutation {
	value: TargetDenylist;
	revokedRuns: boolean;
}
