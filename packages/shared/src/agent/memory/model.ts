import type { AgentMemoryStatus, AgentMemoryDecision } from './values.js';

export interface AgentMemoryView {
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
