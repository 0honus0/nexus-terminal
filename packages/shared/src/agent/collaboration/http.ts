import type { AgentChildView, AgentMessageMetadata } from './model.js';

export interface AgentChildPath {
	appId: string;
	runId: string;
	childId: string;
}

export interface AgentChildrenResponse {
	items: AgentChildView[];
}

export interface AgentMessageMetadataQuery {
	after: number;
	limit: number;
}

export interface AgentMessageMetadataResponse {
	items: AgentMessageMetadata[];
	nextCursor: number;
}
