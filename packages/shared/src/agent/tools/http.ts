import type { AgentToolView } from './model.js';

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
