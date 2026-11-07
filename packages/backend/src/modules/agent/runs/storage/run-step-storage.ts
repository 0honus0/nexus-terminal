import type { AgentRunStepState, AgentRunStepEventType } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentRunStepFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type { StoredStepProposal } from './run-proposal-types.js';

/** Historical model request evidence retained for strict snapshot decoding. */
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
