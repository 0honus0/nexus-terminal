import type { AgentOperationState } from '../operations/values.js';
import type { AgentApprovalRisk, AgentCapability } from '../governance/values.js';
import type { AgentOperationErrorCode } from '../values.js';
import type { AgentToolIdentity } from './identity.js';

/** Tool list projection; arguments are read separately through authenticated single-call details. */
export interface AgentToolView {
	id: string;
	appId: string;
	runId: string;
	sequence: number;
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
	operationHash: string;
	effects: { id: string; operationHash: string }[];
	revision: number;
	state: AgentOperationState;
	/** App-owned file delivered by a completed, server-owned output tool. */
	outputArtifactIds: string[];
	createdAt: number;
	updatedAt: number;
}

/** Authenticated single-call details; no injected credentials or raw result body. */
export interface AgentToolCallDetails {
	tool: AgentToolView;
	argumentsJson: string;
	failureCode: AgentOperationErrorCode | null;
}
