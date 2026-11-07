import type { AgentApprovalMode } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentRunFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type {
	AgentRunStatus,
	AgentRunEventType,
	AgentCreateRunOutcome,
	AgentCancelRunOutcome,
} from '@nexus-terminal/shared/agent/runs/values';
import type { RunAppExecution } from './run-app-execution-types.js';

/** Application command; SQLite's write record is constructed only in this Model. */
export interface CreateRootRunCommand {
	approvalMode: AgentApprovalMode;
	origin: { runId: string; expectedVersion: number } | null;
	inputJson: string;
	connectionIds: number[];
	id: string;
	userId: number;
	appId: string;
	threadId: string;
	prompt: string;
	operationKey: string;
	requestHash: string;
}

export interface CancelRootRunCommand {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number | 'current';
	operationKey: string;
	requestHash: string;
}

export interface RunFailure {
	code: AgentRunFailureCode;
	toolName: string | null;
}

export interface AgentRun {
	approvalMode: AgentApprovalMode;
	failure: RunFailure | null;
	id: string;
	appId: string;
	threadId: string;
	status: AgentRunStatus;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface AgentRunEvent {
	runId: string;
	sequence: number;
	type: AgentRunEventType;
	runVersion: number;
	createdAt: number;
}

export type CreateRunResult =
	| { status: AgentCreateRunOutcome; run: AgentRun }
	| { status: 'replayed'; originalStatus: AgentCreateRunOutcome; run: AgentRun }
	| { status: 'scope_not_found' | 'active_run_conflict' | 'idempotency_conflict' | 'provider_unavailable' };

export type CancelRunResult =
	| { status: AgentCancelRunOutcome; run: AgentRun }
	| { status: 'replayed'; originalStatus: AgentCancelRunOutcome; run: AgentRun }
	| { status: 'not_found' | 'version_conflict' | 'idempotency_conflict' | 'active_run_conflict' };

export interface RunEventPage {
	items: AgentRunEvent[];
	nextCursor: number;
}

export interface CreateRunRequest {
	approvalMode: AgentApprovalMode;
	inputJson: string;
	connectionIds: number[];
	userId: number;
	appId: string;
	threadId: string;
	prompt: string;
	operationKey: string;
}

export interface CancelRunRequest {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
}

export interface RootRunState {
	status: AgentRunStatus;
	version: number;
}

export type CancelRootRunDecision = 'cancel' | 'already_cancelled' | 'version_conflict' | 'active_run_conflict';

export interface RunFrozenInput {
	appExecution: RunAppExecution;
	inputJson: string;
}

export interface RunExecutionCommand {
	deadlineAt: number;
	userId: number;
	appId: string;
	runId: string;
	inputJson: string;
	version: number;
	prompt: string;
	requestHash: string;
}

export interface RunUnstartedFailure {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	creationHash: string;
	now: number;
}

export interface RunAppAuthority {
	enabled: boolean;
	declared: boolean;
}

export interface RunRevocationRequest {
	userId: number | null;
	appId: string | null;
	uncertain: boolean;
}

export type RevokeRuns = (request: RunRevocationRequest) => Promise<void>;

export interface RunPage {
	items: AgentRun[];
	nextCursor: number;
}

export interface RunUsage {
	runId: string;
	runVersion: number;
	inputTokens: number | null;
	outputTokens: number | null;
	reportedModelRequests: number;
	modelRequests: number;
	toolExecutions: number;
}
