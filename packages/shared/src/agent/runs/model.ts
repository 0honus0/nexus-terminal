import type { AgentApprovalMode } from './values.js';
import type { AgentRunFailureCode } from './values.js';
import type { AgentRunEventType, AgentRunStatus } from './values.js';

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

export interface AgentRunUsageView {
	runId: string;
	runVersion: number;
	inputTokens: number | null;
	outputTokens: number | null;
	reportedModelRequests: number;
	modelRequests: number;
	toolExecutions: number;
}
