import type {
	AgentRunStatus,
	AgentRunEventType,
	AgentCreateRunOutcome,
	AgentCancelRunOutcome,
} from '@nexus-terminal/shared/agent/runs/values';

/** Application command; SQLite's write record is constructed only in this Model. */
export interface CreateRootRunCommand {
	id: string;
	userId: number;
	appId: string;
	threadId: string;
	prompt: string;
	operationKey: string;
	requestHash: string;
	createdAt: number;
}

export interface CancelRootRunCommand {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
	requestHash: string;
	requestedAt: number;
}

export interface AgentRun {
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
	| { status: 'scope_not_found' | 'active_run_conflict' | 'idempotency_conflict' };

export type CancelRunResult =
	| { status: AgentCancelRunOutcome; run: AgentRun }
	| { status: 'replayed'; originalStatus: AgentCancelRunOutcome; run: AgentRun }
	| { status: 'not_found' | 'version_conflict' | 'idempotency_conflict' };

export interface RunEventPage {
	items: AgentRunEvent[];
	nextCursor: number;
}

export interface CreateRunRequest {
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

export type CancelRootRunDecision = 'cancel' | 'already_cancelled' | 'version_conflict';
