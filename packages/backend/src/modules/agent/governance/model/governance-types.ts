import type { ExecutionSettings } from '../../execution/model/execution-types.js';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import type { ToolOperation } from '../../runs/model/run-tool-types.js';
import type { RunFrozenInput } from '../../runs/model/run-types.js';
import type { ProviderRecord } from '../../providers/model/provider-types.js';

export interface ToolAuthorityIdentity {
	userId: number;
	appId: string;
	runId: string;
	id: string;
	expectedRevision: number;
	operationHash: string;
}

export type ToolAuthorityTask =
	| { kind: 'dispatch' }
	| { kind: 'inspect'; policyRevision: number }
	| { kind: 'verify'; policyRevision: number }
	| { kind: 'complete'; policyRevision: number; resultText: string; targets: { id: number; version: number }[] };

export interface ToolAuthority {
	operation: ToolOperation;
	policy: GrantState;
	connectionIds: number[];
}

export type ToolPermitDecision = (
	approval: Approval,
	operation: ToolOperation,
	policy: GrantState,
	now: number,
) => boolean;

export type ToolAuthorityDecision = (
	operation: ToolOperation,
	policy: GrantState,
	status: AgentRunStatus,
	frozen: RunFrozenInput,
	provider: ProviderRecord | null,
	connectionIds: number[],
) => boolean;

import type {
	AgentCapability,
	AgentApprovalStatus,
	AgentApprovalKind,
	AgentApprovalRisk,
	AgentCompactionMode,
	AgentContextProfile,
	AgentApprovalDecision,
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
	contextCompactionMode?: AgentCompactionMode;
	contextProfile?: AgentContextProfile;
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

export interface ApprovalRequest {
	id: string;
	userId: number;
	appId: string;
	runId: string;
	toolCallId: string;
	kind: AgentApprovalKind;
}

export interface ApprovalOperation {
	id: string;
	operationHash: string;
	operationRevision: number;
	capability: AgentCapability;
	targetVersion: number | null;
	inspection: ApprovalInspection;
}

export interface ResolveApproval {
	userId: number;
	appId: string;
	approvalId: string;
	decision: AgentApprovalDecision;
	operationHash: string;
	expectedVersion: number;
	operationKey: string;
	feedback?: string;
}

export interface ConsumeApproval {
	userId: number;
	appId: string;
	approvalId: string;
	expectedVersion: number;
}

export interface ExecutionPolicyFacts {
	settings: ExecutionSettings | null;
	app: AppPolicyFacts;
	version: number;
	overrides: PolicyOverrides;
}

export type ApprovalTransition = (
	approval: Approval,
	status: AgentRunStatus,
	now: number,
) => 'expired' | 'superseded' | null;

export type GrantChangeDecision = (current: GrantState) => { allow: boolean; pendingStatus: 'superseded' | null };

export type ExecutionChangeDecision = (current: ExecutionPolicyFacts) => {
	allow: boolean;
	pendingStatus: 'superseded' | null;
};

export type ApprovalRequestDecision = (
	policy: GrantState,
	status: AgentRunStatus,
	operation: ApprovalOperation,
	approvalMode: import('@nexus-terminal/shared/agent/runs/values').AgentApprovalMode,
) => Approval | null;

export type ApprovalResolveDecision = (
	approval: Approval,
	policy: GrantState,
	status: AgentRunStatus,
	version: number,
	now: number,
) => boolean;

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

export interface ApprovalPage {
	items: Approval[];
	after: string | null;
	nextCursor: string | null;
	hasMore: boolean;
}
