import type { AgentToolState } from '@nexus-terminal/shared/agent/tools/values';
import type { AgentApprovalRisk, AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

export interface ToolOperation {
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
	resultText: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface ToolInspectionCommand {
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
	/** Null means a new proposal; replacing content requires an explicit CAS. */
	expectedOperationRevision: number | null;
}

export interface ToolIdentity {
	userId: number;
	appId: string;
	runId: string;
	id: string;
}

export interface ToolSettlement {
	identity: ToolIdentity;
	expectedRevision: number;
	state: 'completed' | 'failed' | 'unknown' | 'cancelled';
	resultText: string | null;
}

export interface ToolEvent {
	toolCallId: string;
	runId: string;
	revision: number;
	operationRevision: number;
	state: AgentToolState;
	operationHash: string;
	createdAt: number;
}

export interface ToolEventPage {
	items: ToolEvent[];
	nextCursor: number;
}

export interface ToolPermissionInspection {
	parent: ToolIdentity;
	inspection: ToolInspectionCommand;
	maxPermissions: number;
}
