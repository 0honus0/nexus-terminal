import type { AgentMemoryStatus, AgentMemoryDecision } from '@nexus-terminal/shared/agent/memory/values';

export interface ManagedMemory {
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

export interface MemoryPage {
	items: ManagedMemory[];
	nextOffset: number | null;
}

export interface MemoryProposalDraft {
	content: string;
	confidence: number;
	expiresAtLocal: string;
	sourceRunId: string;
}

export interface MemoryImportConfirmation {
	id: string;
	memoryId: string;
	sourceAppId: string;
	sourceMemoryId: string;
	sourceVersion: number;
	expiresAt: number;
}
