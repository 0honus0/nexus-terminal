import type { AgentToolView, AgentToolEventView } from './model.js';

export interface AgentToolPath {
	appId: string;
	runId: string;
	toolCallId: string;
}

export interface AgentToolEventsQuery {
	/** Last observed state revision, not an operation content revision. */
	after: number;
	limit: number;
}

export type AgentToolResponse = AgentToolView;

export interface AgentToolEventsResponse {
	items: AgentToolEventView[];
	nextCursor: number;
}
