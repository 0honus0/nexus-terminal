import type { AgentMemoryStatus, AgentMemoryDecision } from '@nexus-terminal/shared/agent/memory/values';

export interface StoredMemoryScope {
	userId: number;
	appId: string;
}

export type StoredMemoryAuthorization =
	{ kind: 'session'; digest: string } | { kind: 'tool'; runId: string; operationId: string; operationHash: string };

export interface StoredMemory {
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

export interface StoredMemoryCreation {
	id: string;
	content: string;
	confidence: number;
	expiresAt: number | null;
	sourceRunId: string | null;
	now: number;
}

export interface StoredMemoryFacts {
	appExists: boolean;
	enabled: boolean;
	identityUserId: number | null;
	sourceExists: boolean;
	count: number;
}

export interface StoredMemoryReviewTask {
	content: string;
	status: AgentMemoryStatus;
	decision: AgentMemoryDecision;
}

export interface StoredMemoryImport {
	id: string;
	memoryId: string;
	sourceAppId: string;
	sourceMemoryId: string;
	sourceVersion: number;
	expiresAt: number;
}

export class MemoryStorageRefusal extends Error {
	constructor(readonly code: 'not_found' | 'version_conflict') {
		super(code);
	}
}

export interface MemoryStorage {
	list(
		scope: StoredMemoryScope,
		status: AgentMemoryStatus | 'all',
		offset: number,
		limit: number,
	): Promise<StoredMemory[]>;
	get(scope: StoredMemoryScope, id: string): Promise<StoredMemory | null>;
	create(
		scope: StoredMemoryScope,
		auth: StoredMemoryAuthorization,
		input: StoredMemoryCreation,
		admit: (facts: StoredMemoryFacts) => void,
	): Promise<StoredMemory>;
	review(
		scope: StoredMemoryScope,
		auth: StoredMemoryAuthorization,
		id: string,
		version: number,
		now: number,
		admit: (facts: StoredMemoryFacts) => void,
		decide: (memory: StoredMemory) => StoredMemoryReviewTask,
	): Promise<StoredMemory>;
	previewImport(
		scope: StoredMemoryScope,
		auth: StoredMemoryAuthorization,
		input: StoredMemoryImportCreation,
		now: number,
		admit: (facts: StoredMemoryFacts) => void,
		admitSource: (facts: StoredMemoryImportFacts, confirmations: number) => void,
	): Promise<StoredMemoryImport>;
	confirmImport(
		scope: StoredMemoryScope,
		auth: StoredMemoryAuthorization,
		id: string,
		now: number,
		admit: (facts: StoredMemoryFacts) => void,
		admitSource: (facts: StoredMemoryImportFacts) => void,
	): Promise<StoredMemory>;
	recall(
		scope: StoredMemoryScope,
		auth: StoredMemoryAuthorization,
		now: number,
		limit: number,
		admit: (facts: StoredMemoryFacts) => void,
	): Promise<StoredMemory[]>;
}

export interface StoredMemoryImportCreation {
	id: string;
	memoryId: string;
	sourceAppId: string;
	sourceMemoryId: string;
	expiresAt: number;
}

export interface StoredMemoryImportFacts {
	source: StoredMemory;
	sourceEnabled: boolean;
}
