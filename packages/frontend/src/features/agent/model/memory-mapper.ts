import type { AgentMemoryView, AgentMemoryImportView } from '@nexus-terminal/shared/agent/memory/model';
import type { AgentMemoryProposalRequest } from '@nexus-terminal/shared/agent/memory/http';
import type { ManagedMemory, MemoryImportConfirmation, MemoryProposalDraft } from './memory-types';

export function fromMemory(value: AgentMemoryView): ManagedMemory {
	return {
		id: value.id,
		appId: value.appId,
		content: value.content,
		confidence: value.confidence,
		status: value.status,
		sourceRunId: value.sourceRunId,
		expiresAt: value.expiresAt,
		reviewAction: value.reviewAction,
		reviewedAt: value.reviewedAt,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function fromMemoryImport(value: AgentMemoryImportView): MemoryImportConfirmation {
	return {
		id: value.id,
		memoryId: value.memoryId,
		sourceAppId: value.sourceAppId,
		sourceMemoryId: value.sourceMemoryId,
		sourceVersion: value.sourceVersion,
		expiresAt: value.expiresAt,
	};
}

export function toMemoryProposal(value: MemoryProposalDraft): AgentMemoryProposalRequest {
	return {
		content: value.content,
		confidence: value.confidence,
		expiresAt: value.expiresAtLocal === '' ? null : new Date(value.expiresAtLocal).getTime(),
		sourceRunId: value.sourceRunId === '' ? null : value.sourceRunId,
	};
}
