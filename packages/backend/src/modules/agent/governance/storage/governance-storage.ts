import type { AgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity';
import type { StoredExecutionSettings } from '../../execution/storage/execution-storage.js';
import type { StoredToolOperation } from '../../runs/storage/run-tool-storage.js';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import type { StoredFrozenInput } from '../../runs/storage/run-storage.js';
import type { ProviderStoredRow } from '../../providers/storage/provider-storage.js';

export interface StoredToolAuthorityIdentity {
	userId: number;
	appId: string;
	runId: string;
	id: string;
	expectedRevision: number;
	operationHash: string;
}

export type StoredToolAuthorityTask =
	| { kind: 'dispatch' }
	| { kind: 'inspect'; policyRevision: number }
	| { kind: 'verify'; policyRevision: number }
	| { kind: 'result_source'; policyRevision: number; reader: StoredToolAuthorityIdentity }
	| {
			kind: 'complete';
			policyRevision: number;
			resultText: string;
			outputArtifactIds: string[];
			targets: { id: number; version: number }[];
	  };

export interface StoredToolAuthority {
	operation: StoredToolOperation;
	policy: StoredPolicy;
	connectionIds: number[];
}

export type StoredToolPermitDecision = (
	approval: StoredApproval,
	operation: StoredToolOperation,
	policy: StoredPolicy,
	now: number,
) => boolean;

export type StoredToolAuthorityDecision = (
	operation: StoredToolOperation,
	policy: StoredPolicy,
	status: AgentRunStatus,
	frozen: StoredFrozenInput,
	provider: ProviderStoredRow | null,
	connectionIds: number[],
) => boolean;

import type {
	AgentCapability,
	AgentApprovalStatus,
	AgentApprovalKind,
	AgentApprovalRisk,
	AgentApprovalDecision,
} from '@nexus-terminal/shared/agent/governance/values';

export type StoredScope =
	| { kind: 'global' }
	| { kind: 'targets'; sshMode?: undefined }
	| { kind: 'targets'; sshMode: 'all' }
	| { kind: 'targets'; sshMode: 'ids'; sshIds: string[] };

export interface StoredPolicyOverrides {
	maxModelRequests?: number;
	maxActiveExecutionSeconds?: number;
	toolTimeoutSeconds?: number;
	maxToolOutputBytes?: number;
	maxRecallItems?: number;
	maxRecallBytes?: number;
	maxSubagentMessages?: number;
	maxSubagentMessageBytes?: number;
}

export interface StoredGrant {
	capability: AgentCapability;
	schemaVersion: 2;
	scope: StoredScope;
	grantedAt: number;
}

export interface StoredPolicy {
	app: StoredAppPolicyFacts;
	userId: number;
	appId: string;
	revision: number;
	executionVersion: number;
	overrides: StoredPolicyOverrides;
	grants: StoredGrant[];
}

export interface StoredApproval {
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
	inspection: {
		toolName: string;
		toolVersion: string;
		identity: AgentToolIdentity;
		risk: AgentApprovalRisk;
		mutation: boolean;
		targetConnectionId: number | null;
		summary: string;
	};
}

export type GrantReplaceResult = { status: 'ok'; policy: StoredPolicy } | { status: 'not_found' | 'version_conflict' };

export type ExecutionReplaceResult =
	| { status: 'ok'; policy: StoredPolicy; settings: StoredExecutionSettings | null }
	| { status: 'not_found' | 'version_conflict' };

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

export interface StoredToolCatalogFacts {
	policy: StoredPolicy;
	connectionIds: number[];
	denylistRevision: number;
}

export interface GovernanceStorage {
	toolCatalog(userId: number, appId: string, runId: string): Promise<StoredToolCatalogFacts | null>;
	denylist(): Promise<StoredTargetDenylist>;
	replaceDenylist(
		input: StoredDenylistCommand,
		now: () => number,
		decide: (current: StoredTargetDenylist) => { revoke: boolean },
	): Promise<StoredDenylistMutation | 'version_conflict' | 'not_found'>;
	execution(
		userId: number,
		appId: string,
	): Promise<{ policy: StoredPolicy; settings: StoredExecutionSettings | null } | null>;
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
		decide: (
			current: StoredPolicy,
			settings: StoredExecutionSettings | null,
		) => { allow: boolean; pendingStatus: 'superseded' | null },
	): Promise<ExecutionReplaceResult>;
}

export interface StoredAppPolicyFacts {
	enabled: boolean;
	declared: boolean;
	capabilities: AgentCapability[];
	deniedTargetIds: number[];
}

export interface StoredTargetDenylist {
	revision: number;
	entries: { connectionId: number; reason: string; changedBy: number; changedAt: number }[];
}

export interface StoredDenylistCommand {
	userId: number;
	expectedRevision: number;
	targets: { id: number; version: number }[];
	reason: string;
}

export interface StoredDenylistMutation {
	value: StoredTargetDenylist;
	revokedRuns: boolean;
}

export interface StoredApprovalPage {
	items: StoredApproval[];
	after: string | null;
	nextCursor: string | null;
	hasMore: boolean;
}
