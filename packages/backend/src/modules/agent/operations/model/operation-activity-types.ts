import type { AgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity';
import type { AgentApprovalRisk, AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { AgentOperationState } from '@nexus-terminal/shared/agent/operations/values';
import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';

/** A tool is a real Operation and its trusted effect evidence, never a synthetic model step. */
export interface OperationActivity {
	id: string;
	sequence: number;
	appId: string;
	runId: string;
	parentOperationId: string | null;
	toolName: string;
	toolVersion: string;
	identity: AgentToolIdentity;
	capability: AgentCapability;
	targetId: number | null;
	targetVersion: number | null;
	risk: AgentApprovalRisk;
	mutation: boolean;
	summary: string;
	argumentsJson: string;
	operationHash: string;
	revision: number;
	state: AgentOperationState;
	effects: { id: string; operationHash: string }[];
	outputArtifactIds: string[];
	failureCode: AgentOperationErrorCode | null;
	createdAt: number;
	updatedAt: number;
}

export interface OperationActivityCursor {
	createdAt: number;
	id: string;
}

export interface OperationActivityPage {
	items: OperationActivity[];
	nextCursor: OperationActivityCursor | null;
}
