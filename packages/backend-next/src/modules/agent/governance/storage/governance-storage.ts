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

export type StoredScope =
	| { kind: 'global' }
	| { kind: 'targets'; sshMode?: undefined }
	| { kind: 'targets'; sshMode: 'all' }
	| { kind: 'targets'; sshMode: 'ids'; sshIds: string[] };

export interface StoredPolicyOverrides {
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

export interface StoredGrant {
	capability: AgentCapability;
	schemaVersion: 2;
	scope: StoredScope;
	grantedAt: number;
}

export interface StoredPolicy {
	userId: number;
	appId: string;
	revision: number;
	executionVersion: number;
	overrides: StoredPolicyOverrides;
	grants: StoredGrant[];
}

export interface StoredApproval {
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
	inspection: {
		toolName: string;
		toolVersion: string;
		risk: AgentApprovalRisk;
		mutation: boolean;
		targetConnectionId: number | null;
		summary: string;
	};
}

export type GrantReplaceResult = { status: 'ok'; policy: StoredPolicy } | { status: 'not_found' | 'version_conflict' };

export type ExecutionReplaceResult =
	{ status: 'ok'; policy: StoredPolicy } | { status: 'not_found' | 'version_conflict' };

export type ApprovalCommitResult =
	| { status: 'ok' | 'replayed'; approval: StoredApproval }
	| { status: 'not_found' | 'version_conflict' | 'approval_stale' | 'idempotency_conflict' };

export interface StoredApprovalResolution {
	userId: number;
	appId: string;
	approvalId: string;
	decision: AgentApprovalDecision;
	expectedVersion: number;
	operationKey: string;
	requestHash: string;
	feedback: string | null;
}

export interface GovernanceStorage {
	policy(userId: number, appId: string): Promise<StoredPolicy | null>;
	replaceGrants(
		userId: number,
		appId: string,
		expectedRevision: number,
		grants: StoredGrant[],
		decide: (current: StoredPolicy) => { allow: boolean; pendingStatus: 'superseded' | null },
	): Promise<GrantReplaceResult>;
	replaceExecution(
		userId: number,
		appId: string,
		version: number,
		overrides: StoredPolicyOverrides,
		decide: (current: StoredPolicy) => { allow: boolean; pendingStatus: 'superseded' | null },
	): Promise<ExecutionReplaceResult>;
	getApproval(
		userId: number,
		appId: string,
		id: string,
		now: () => number,
		transition: (
			approval: StoredApproval,
			runStatus: AgentRunStatus,
			now: number,
		) => 'expired' | 'superseded' | null,
	): Promise<StoredApproval | null>;
	listApprovals(
		userId: number,
		appId: string,
		runId: string,
		now: () => number,
		transition: (
			approval: StoredApproval,
			runStatus: AgentRunStatus,
			now: number,
		) => 'expired' | 'superseded' | null,
	): Promise<StoredApproval[] | null | 'limit_exceeded'>;
	requestApproval(
		input: { userId: number; appId: string; runId: string },
		create: (policy: StoredPolicy, runStatus: AgentRunStatus, runVersion: number) => StoredApproval | null,
	): Promise<StoredApproval | null>;
	resolveApproval(
		input: StoredApprovalResolution,
		now: () => number,
		transition: (
			approval: StoredApproval,
			runStatus: AgentRunStatus,
			now: number,
		) => 'expired' | 'superseded' | null,
		decide: (
			approval: StoredApproval,
			policy: StoredPolicy,
			runStatus: AgentRunStatus,
			runVersion: number,
			now: number,
		) => boolean,
	): Promise<ApprovalCommitResult>;
	invalidateRunApprovals(
		userId: number,
		appId: string,
		runId: string,
		now: () => number,
		transition: (
			approval: StoredApproval,
			runStatus: AgentRunStatus,
			now: number,
		) => 'expired' | 'superseded' | null,
	): Promise<number>;
}
