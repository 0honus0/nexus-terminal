import type { AgentApprovalMode } from './values.js';
import type { AgentRunView, AgentRunEventView } from './model.js';
import type { AgentCreateRunOutcome, AgentCancelRunOutcome } from './values.js';

export interface AgentCreateRunRequest {
	approvalMode: AgentApprovalMode;
	prompt: string;
	/** Restricts this Run; selection never grants Agent permission. Empty means no selected targets. */
	connectionIds: number[];
	/** App-owned versioned input. The Host does not select a scheduling/model mode. */
	inputJson: string;
}

export interface AgentCancelRunRequest {
	expectedVersion: number;
}

export interface AgentResumeRunRequest {
	expectedVersion: number;
	/** App-owned response to its recorded input request. */
	inputJson: string;
}

export type AgentResumeRunResponse =
	{ status: 'resumed'; run: AgentRunView } | { status: 'replayed'; originalStatus: 'resumed'; run: AgentRunView };

export interface AgentRunSuspensionView {
	runId: string;
	runVersion: number;
	checkpointVersion: number;
	inputRequest: import('../plugins/content.js').AgentPluginContentReference;
	suspendedAt: number;
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

export interface AgentCloseResourcesRequest {
	appVersion: number;
	target: { kind: 'app' } | { kind: 'session'; runId: string; sessionId: string };
	confirmed: boolean;
}

export interface AgentCloseResourcesResponse {
	status: 'closed' | 'confirmation_required';
	activeRuns: number;
	activeOperations: number;
	backgroundJobs: number;
}
