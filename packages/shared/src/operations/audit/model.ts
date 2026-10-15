import type { OperationEvent } from '../values.js';

export interface AuditView {
	id: number;
	event: OperationEvent;
	createdAt: number;
	userId: number | null;
	sourceIp: string | null;
	subjectId: string | null;
	route: string | null;
	statusCode: number | null;
}
