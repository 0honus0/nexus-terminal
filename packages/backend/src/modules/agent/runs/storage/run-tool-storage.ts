import type { StoredExecutionSettings, StoredExecutionUsage } from '../../execution/storage/execution-storage.js';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentToolState } from '@nexus-terminal/shared/agent/tools/values';
import type { AgentApprovalRisk, AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

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
	capability: AgentCapability;
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
	/** Saved image owned by this App; only populated for a completed image_generate. */
	generatedImageId: string | null;
	resultText: string | null;
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
	capability: AgentCapability;
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
	resultText: string | null;
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

export interface RunToolStorage {
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
