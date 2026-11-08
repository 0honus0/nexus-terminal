import type { StoredExecutionSettings } from '../../execution/storage/execution-storage.js';

import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

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

export type GrantReplaceResult = { status: 'ok'; policy: StoredPolicy } | { status: 'not_found' | 'version_conflict' };

export type ExecutionReplaceResult =
	| { status: 'ok'; policy: StoredPolicy; settings: StoredExecutionSettings | null }
	| { status: 'not_found' | 'version_conflict' };

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
