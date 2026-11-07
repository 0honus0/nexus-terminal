import type { AgentPluginHostOperationName } from '@nexus-terminal/shared/agent/plugins/values';
import type { AgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity';
import type { AgentRunFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type { StoredExecutionSettings, StoredExecutionUsage } from '../../execution/storage/execution-storage.js';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentToolState } from '@nexus-terminal/shared/agent/tools/values';
import type { AgentApprovalRisk, AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { StoredPluginOperationAuthority } from '../../plugins/storage/plugin-operation-storage.js';

/** No application objects cross the journal boundary. Arguments and results stay private. */
export interface StoredToolOperation {
	id: string;
	userId: number;
	appId: string;
	runId: string;
	modelStepIndex: number;
	providerCallId: string;
	toolName: string;
	toolVersion: string;
	identity: AgentToolIdentity;
	capability: AgentCapability;
	requiredCapabilities: AgentCapability[];
	targetId: number | null;
	targetVersion: number | null;
	risk: AgentApprovalRisk;
	mutation: boolean;
	summary: string;
	argumentsJson: string;
	operationHash: string;
	operationRevision: number;
	revision: number;
	state: AgentToolState;
	/** App-owned file delivered by a completed, server-owned output tool. */
	outputArtifactIds: string[];
	resultText: string | null;
	failureCode: AgentRunFailureCode | null;
	createdAt: number;
	updatedAt: number;
}

export interface StoredToolInspection {
	id: string;
	userId: number;
	appId: string;
	runId: string;
	modelStepIndex: number;
	providerCallId: string;
	toolName: string;
	toolVersion: string;
	identity: AgentToolIdentity;
	capability: AgentCapability;
	requiredCapabilities: AgentCapability[];
	targetId: number | null;
	targetVersion: number | null;
	risk: AgentApprovalRisk;
	mutation: boolean;
	summary: string;
	argumentsJson: string;
	operationHash: string;
	/** Null means a new proposal; replacing content requires an explicit CAS. */
	expectedOperationRevision: number | null;
}

export interface StoredToolIdentity {
	userId: number;
	appId: string;
	runId: string;
	id: string;
}

export interface StoredToolSettlement {
	identity: StoredToolIdentity;
	expectedRevision: number;
	state: 'completed' | 'failed' | 'unknown' | 'cancelled';
	outputArtifactIds: string[];
	resultText: string | null;
}

export interface StoredManagedToolCancellation {
	identity: StoredToolIdentity;
	operationHash: string;
	dispatchedRevision: number;
	binding: Pick<
		StoredPluginOperationAuthority,
		'packageId' | 'installationRevision' | 'instanceId' | 'instanceRevision'
	>;
}

export interface StoredManagedCancellationFacts {
	runStatus: AgentRunStatus;
	fencedDispatch: boolean;
	descendantsUnstarted: boolean;
}

export interface StoredToolEvent {
	toolCallId: string;
	runId: string;
	revision: number;
	operationRevision: number;
	state: AgentToolState;
	operationHash: string;
	createdAt: number;
}

export interface StoredToolListCursor {
	createdAt: number;
	id: string;
}

export interface StoredToolListPage {
	items: StoredToolOperation[];
	nextCursor: StoredToolListCursor | null;
}

export interface StoredPermissionInspection {
	parent: StoredToolIdentity;
	inspection: StoredToolInspection;
	maxPermissions: number;
}

export interface StoredToolChildInspection {
	parent: StoredToolIdentity;
	parentOperationHash: string;
	inspection: StoredToolInspection;
	plugin: StoredPluginOperationAuthority;
}

export type StoredToolChildRelation = {
	toolId: string;
	parentId: string;
	parentHash: string;
	requestKey: string;
} & (
	| { kind: 'acp_permission'; plugin: null }
	| {
			kind: 'plugin_tool';
			plugin: {
				packageId: string;
				installationRevision: number;
				instanceId: string;
				instanceRevision: number;
			};
	  }
);

export interface RunToolStorage {
	confirmManagedCancellation(
		input: StoredManagedToolCancellation,
		clock: () => number,
		decide: (current: StoredToolOperation, facts: StoredManagedCancellationFacts) => boolean,
	): Promise<StoredToolOperation | null>;
	confirmOutputArtifacts(
		input: StoredToolOutputEvidence,
		clock: () => number,
	): Promise<StoredToolOperation | 'not_found' | 'version_conflict'>;
	resultSources(identity: StoredToolIdentity): Promise<StoredToolResultSourceAuthority[] | null>;
	inspectChild(
		input: StoredToolChildInspection,
		clock: () => number,
		admitBudget: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<StoredToolOperation | 'not_found' | 'version_conflict'>;
	inspectPermission(
		input: StoredPermissionInspection,
		clock: () => number,
		accept: (parent: StoredToolOperation, status: AgentRunStatus) => boolean,
		admitBudget: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<StoredToolOperation | 'not_found' | 'version_conflict'>;
	inspect(
		command: StoredToolInspection,
		clock: () => number,
		admitBudget: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<StoredToolOperation | 'not_found' | 'version_conflict'>;
	get(identity: StoredToolIdentity): Promise<StoredToolOperation | null>;
	listThread(
		input: { userId: number; appId: string; threadId: string },
		before: StoredToolListCursor | null,
		limit: number,
	): Promise<StoredToolListPage | null>;
	finish(
		command: StoredToolSettlement,
		now: () => number,
		decide: (current: StoredToolOperation) => boolean,
	): Promise<StoredToolOperation | 'not_found' | 'version_conflict'>;
	reconcile(now: number): Promise<number>;
}

export interface StoredToolResultSourceAuthority {
	id: string;
	userId: number;
	appId: string;
	runId: string;
	identity: AgentToolIdentity;
	operationHash: string;
	revision: number;
	toolName: string;
	toolVersion: string;
	capability: AgentCapability;
	requiredCapabilities: AgentCapability[];
	targetId: number | null;
	targetVersion: number | null;
	risk: AgentApprovalRisk;
	mutation: boolean;
}

/** Trusted Host output evidence, not an operation-state mutation or an execution request. */
export interface StoredToolOutputEvidence {
	identity: StoredToolIdentity;
	operationHash: string;
	operation: AgentPluginHostOperationName;
	outputArtifactIds: string[];
}
