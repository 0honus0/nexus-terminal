import type { AgentRunView, AgentRunEventView, AgentRunStepView, AgentRunStepEventView } from './model.js';
import type { AgentCreateRunOutcome, AgentCancelRunOutcome } from './values.js';

export interface AgentCreateRunRequest {
	prompt: string;
	/** Selected configuration must match when the Run is created. */
	model: { providerId: string; modelId: string; configurationVersion: number };
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

export interface AgentRunStepPath extends AgentRunPath {
	stepIndex: number;
}

export type AgentRunStepResponse = AgentRunStepView;

/** Only audit metadata is public: a delta's byte length, never the model's raw text. */
export interface AgentRunStepEventsResponse {
	items: AgentRunStepEventView[];
	nextCursor: number;
}
