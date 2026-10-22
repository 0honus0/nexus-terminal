import type { AgentMemoryStatus, AgentMemoryDecision } from '@nexus-terminal/shared/agent/memory/values';

export interface MemoryScope {
	userId: number;
	appId: string;
}

export type MemoryActor =
	| { kind: 'session'; userId: number; appId: string; token: string }
	| { kind: 'tool'; userId: number; appId: string; runId: string; operationId: string; operationHash: string };

export interface MemoryRecord {
	id: string;
	appId: string;
	content: string;
	confidence: number;
	status: AgentMemoryStatus;
	sourceRunId: string | null;
	expiresAt: number | null;
	reviewAction: AgentMemoryDecision | null;
	reviewedAt: number | null;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface MemoryProposal {
	content: string;
	confidence: number;
	expiresAt: number | null;
	sourceRunId: string | null;
}

export interface MemoryReview {
	expectedVersion: number;
	decision: AgentMemoryDecision;
	content: string | null;
}

export interface MemoryQuery {
	status: AgentMemoryStatus | 'all';
	offset: number;
	limit: number;
	threadId?: string;
}

export interface MemoryAdmissionFacts {
	appExists: boolean;
	enabled: boolean;
	identityUserId: number | null;
	sourceExists: boolean;
	count: number;
	now: number;
}

export interface MemoryReviewFacts {
	memory: MemoryRecord;
	now: number;
}

export interface MemoryReviewTask {
	content: string;
	status: AgentMemoryStatus;
	decision: AgentMemoryDecision;
}

export interface MemoryRecallInput {
	query: string;
	limit: number;
}

export interface MemoryRecallItem {
	memory: MemoryRecord;
	score: number;
}
