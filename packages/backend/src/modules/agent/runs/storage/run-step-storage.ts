import type { AgentRunStepState, AgentRunStepEventType } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentRunStepFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type { StoredStepProposal } from './run-proposal-types.js';

/** Durable model request journal owned by the existing Run aggregate. Not a second Run registry. */
export type StoredStepState = AgentRunStepState;

export interface StoredRunStep {
	runId: string;
	stepIndex: number;
	state: StoredStepState;
	revision: number;
	expectedRunVersion: number;
	requestHash: string;
	creationHash: string;
	responseReceived: boolean;
	textBytes: number;
	finishReason?: import('@nexus-terminal/shared/agent/runs/values').AgentRunStepFinishReason;
	proposals: StoredStepProposal[];
	inputTokens?: number;
	outputTokens?: number;
	failureCode?: AgentRunStepFailureCode;
	createdAt: number;
	updatedAt: number;
}

export interface StoredRunStepEvent {
	runId: string;
	stepIndex: number;
	sequence: number;
	kind: AgentRunStepEventType;
	textDelta?: string;
	inputTokens?: number;
	outputTokens?: number;
	createdAt: number;
}

export interface StoredRunUsage {
	runId: string;
	runVersion: number;
	inputTokens: number | null;
	outputTokens: number | null;
	reportedModelRequests: number;
	modelRequests: number;
	toolExecutions: number;
}
