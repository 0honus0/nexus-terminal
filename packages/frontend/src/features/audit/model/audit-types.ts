import type { OperationEvent } from '@nexus-terminal/shared/operations/values';

export interface AuditEntry {
	id: number;
	event: OperationEvent;
	createdAt: number;
	userId: number | null;
	sourceIp: string | null;
	subjectId: string | null;
	route: string | null;
	statusCode: number | null;
}

export interface AuditPage {
	items: AuditEntry[];
	nextOffset: number | null;
}

export interface AuditQuery {
	event?: OperationEvent | null;
	from?: number | null;
	to?: number | null;
	q?: string;
	offset?: number;
	limit?: number;
}
