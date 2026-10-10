import type { AgentRunView, AgentRunEventView } from './model.js';
import type { AgentCreateRunOutcome, AgentCancelRunOutcome } from './values.js';

export interface AgentCreateRunRequest {
	prompt: string;
}

export interface AgentCancelRunRequest {
	expectedVersion: number;
}

/** Decoded Idempotency-Key header, never a JSON body or authenticated identity. */
export interface AgentRunCommandHeaders {
	operationKey: string;
}

export interface AgentCreateRunPath {
	appId: string;
	threadId: string;
}

export interface AgentRunPath {
	appId: string;
	runId: string;
}

export interface AgentRunEventsQuery {
	after: number;
	limit: number;
}

export type AgentCreateRunResponse =
	| { status: AgentCreateRunOutcome; run: AgentRunView }
	| { status: 'replayed'; originalStatus: AgentCreateRunOutcome; run: AgentRunView };

export type AgentCancelRunResponse =
	| { status: AgentCancelRunOutcome; run: AgentRunView }
	| { status: 'replayed'; originalStatus: AgentCancelRunOutcome; run: AgentRunView };

export type AgentGetRunResponse = AgentRunView;

export interface AgentRunEventsResponse {
	items: AgentRunEventView[];
	nextCursor: number;
}
