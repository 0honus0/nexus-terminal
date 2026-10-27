import type { AgentToolState } from './values.js';
import type { AgentApprovalRisk, AgentCapability } from '../governance/values.js';
import type { AgentRunFailureCode } from '../runs/values.js';

/** Tool list projection; arguments are read separately through authenticated single-call details. */
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
	summary: string;
	operationHash: string;
	operationRevision: number;
	revision: number;
	state: AgentToolState;
	/** Saved image owned by this App; only populated for a completed image_generate. */
	generatedImageId: string | null;
	createdAt: number;
	updatedAt: number;
}

/** Authenticated single-call details; no injected credentials or raw result body. */
export interface AgentToolCallDetails {
	tool: AgentToolView;
	argumentsJson: string;
	failureCode: AgentRunFailureCode | null;
}
