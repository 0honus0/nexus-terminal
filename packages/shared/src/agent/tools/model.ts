import type { AgentToolState } from './values.js';
import type { AgentApprovalRisk, AgentCapability } from '../governance/values.js';

/** Audit metadata only; arguments, result bodies and provider identifiers stay private. */
export interface AgentToolView {
	id: string;
	appId: string;
	runId: string;
	modelStepIndex: number;
	toolName: string;
	toolVersion: string;
	capability: AgentCapability;
	targetId: number | null;
	targetVersion: number | null;
	risk: AgentApprovalRisk;
	mutation: boolean;
	operationHash: string;
	operationRevision: number;
	revision: number;
	state: AgentToolState;
	createdAt: number;
	updatedAt: number;
}

export interface AgentToolEventView {
	toolCallId: string;
	runId: string;
	revision: number;
	operationRevision: number;
	state: AgentToolState;
	operationHash: string;
	createdAt: number;
}
