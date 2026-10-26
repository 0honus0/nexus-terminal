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

export interface AgentThreadToolsPath {
	appId: string;
	threadId: string;
}

export interface AgentThreadToolsQuery {
	/** Older-than cursor in `createdAt:id` form; null starts from the latest records. */
	before: string | null;
	limit: number;
}

export interface AgentThreadToolsResponse {
	items: AgentToolView[];
	nextCursor: string | null;
}
