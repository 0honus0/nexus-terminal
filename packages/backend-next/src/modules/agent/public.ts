import type { AgentAppView, AgentThreadView } from '@nexus-terminal/shared/agent/scope/model';
import type { AgentRunView } from '@nexus-terminal/shared/agent/runs/model';
import type { AgentRunEventsResponse } from '@nexus-terminal/shared/agent/runs/http';
import type { AgentCreateRunOutcome, AgentCancelRunOutcome } from '@nexus-terminal/shared/agent/runs/values';

/** Trusted backend inputs: identity comes from authentication, not a request body. */
export interface AgentCreateRunInput {
	userId: number;
	appId: string;
	threadId: string;
	prompt: string;
	operationKey: string;
}

export interface AgentCancelRunInput {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
}

export type AgentCreateRunResult =
	| { status: AgentCreateRunOutcome; run: AgentRunView }
	| { status: 'replayed'; originalStatus: AgentCreateRunOutcome; run: AgentRunView }
	| { status: 'scope_not_found' | 'active_run_conflict' | 'idempotency_conflict' };

export type AgentCancelRunResult =
	| { status: AgentCancelRunOutcome; run: AgentRunView }
	| { status: 'replayed'; originalStatus: AgentCancelRunOutcome; run: AgentRunView }
	| { status: 'not_found' | 'version_conflict' | 'idempotency_conflict' };

export interface AgentStateApi {
	createApp(userId: number, name: string): Promise<AgentAppView>;
	createThread(userId: number, appId: string, title: string): Promise<AgentThreadView | null>;
	createRun(input: AgentCreateRunInput): Promise<AgentCreateRunResult>;
	cancelRun(input: AgentCancelRunInput): Promise<AgentCancelRunResult>;
	getRun(userId: number, appId: string, runId: string): Promise<AgentRunView | null>;
	listEvents(
		userId: number,
		appId: string,
		runId: string,
		after: number,
		limit: number,
	): Promise<AgentRunEventsResponse | null>;
}
