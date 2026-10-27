import type { AgentMemoryView } from './model.js';
import type { AgentMemoryDecision, AgentMemoryStatus } from './values.js';

export interface AgentMemoryProposalRequest {
	content: string;
	confidence: number;
	expiresAt: number | null;
	sourceRunId: string | null;
}

export interface AgentMemoryReviewRequest {
	expectedVersion: number;
	decision: AgentMemoryDecision;
	content: string | null;
}

export interface AgentMemoryPath {
	appId: string;
	memoryId: string;
}

export interface AgentMemoryListQuery {
	status: AgentMemoryStatus | 'all';
	limit: number;
	offset: number;
	threadId?: string;
}

export interface AgentMemoryResponse {
	memory: AgentMemoryView;
}

export interface AgentMemoryListResponse {
	items: AgentMemoryView[];
	nextOffset: number | null;
}
