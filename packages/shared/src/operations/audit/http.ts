import type { AuditView } from './model.js';
import type { OperationEvent } from '../values.js';

export interface AuditQuery {
	event: OperationEvent | null;
	from: number | null;
	to: number | null;
	q: string;
	offset: number;
	limit: number;
}

export interface AuditResponse {
	items: AuditView[];
	nextOffset: number | null;
}
