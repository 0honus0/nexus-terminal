import type { AgentApprovalMode } from './values.js';
import type { AgentReasoningEffort } from '../providers/values.js';
import type { AgentRunView, AgentRunEventView } from './model.js';
import type { AgentCreateRunOutcome, AgentCancelRunOutcome } from './values.js';

export interface AgentCreateRunRequest {
	approvalMode: AgentApprovalMode;
	prompt: string;
	/** Restricts this Run; selection never grants Agent permission. Empty means no selected targets. */
	connectionIds: number[];
	/** Selected configuration must match when the Run is created. */
	model: {
		providerId: string;
		modelId: string;
		configurationVersion: number;
		reasoningEffort?: AgentReasoningEffort;
	};
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
