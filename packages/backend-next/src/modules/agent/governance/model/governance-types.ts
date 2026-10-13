import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
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
	appId: string;
	userId: number;
	revision: number;
	grants: Grant[];
}

export type PolicyOverrides = {
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
	operationHash: string;
	kind: AgentApprovalKind;
	inputRevision: number;
	capability: AgentCapability;
	connectionId: number | null;
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

export interface ExecutionPolicyFacts {
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

export type ApprovalRequestDecision = (policy: GrantState, status: AgentRunStatus, version: number) => Approval | null;

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
