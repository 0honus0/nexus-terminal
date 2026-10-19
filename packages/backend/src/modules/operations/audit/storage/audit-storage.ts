import type { OperationEvent } from '@nexus-terminal/shared/operations/values';

export interface StoredAuditInput {
	key: string;
	event: OperationEvent;
	createdAt: number;
	userId: number | null;
	sourceIp: string | null;
	subjectId: string | null;
	route: string | null;
	statusCode: number | null;
}

export interface StoredAuditRecord {
	id: number;
	event: OperationEvent;
	createdAt: number;
	userId: number | null;
	sourceIp: string | null;
	subjectId: string | null;
	route: string | null;
	statusCode: number | null;
}

export interface StoredAuditQuery {
	event: OperationEvent | null;
	from: number | null;
	to: number | null;
	q: string;
	offset: number;
	limit: number;
}

export interface AuditStorage {
	append(input: StoredAuditInput, retain: number): Promise<{ record: StoredAuditRecord; created: boolean }>;
	prune(retain: number): Promise<void>;
	list(query: StoredAuditQuery): Promise<StoredAuditRecord[]>;
}
