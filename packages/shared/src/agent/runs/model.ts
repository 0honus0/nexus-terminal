import type { AgentApprovalMode } from './values.js';
import type { AgentRunFailureCode } from './values.js';
import type { AgentRunStepFailureCode } from './values.js';
import type { AgentRunEventType, AgentRunStatus, AgentRunStepState } from './values.js';

export interface AgentRunFailureView {
	code: AgentRunFailureCode;
	toolName: string | null;
}

export interface AgentRunView {
	approvalMode: AgentApprovalMode;
	failure: AgentRunFailureView | null;
	id: string;
	appId: string;
	threadId: string;
	status: AgentRunStatus;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface AgentRunEventView {
	runId: string;
	sequence: number;
	type: AgentRunEventType;
	runVersion: number;
	createdAt: number;
}

/** Read-only model-step audit. Never includes prompts, endpoints, credentials or raw output. */
export interface AgentRunStepView {
	runId: string;
	stepIndex: number;
	state: AgentRunStepState;
	revision: number;
	runVersion: number;
	textBytes: number;
	finishReason?: import('./values.js').AgentRunStepFinishReason;
	inputTokens?: number;
	outputTokens?: number;
	failureCode?: AgentRunStepFailureCode;
	createdAt: number;
	updatedAt: number;
}

export type AgentRunStepEventView =
	| { runId: string; stepIndex: number; sequence: number; kind: 'text.delta'; textBytes: number; createdAt: number }
	| {
			runId: string;
			stepIndex: number;
			sequence: number;
			kind: 'usage';
			inputTokens: number;
			outputTokens: number;
			createdAt: number;
	  }
	| {
			runId: string;
			stepIndex: number;
			sequence: number;
			kind: 'step.completed' | 'step.failed' | 'step.unknown';
			createdAt: number;
	  };

export interface AgentRunUsageView {
	runId: string;
	runVersion: number;
	inputTokens: number | null;
	outputTokens: number | null;
	reportedModelRequests: number;
	modelRequests: number;
	toolExecutions: number;
}
