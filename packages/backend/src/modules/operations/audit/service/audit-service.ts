import { OPERATION_EVENTS } from '@nexus-terminal/shared/operations/values';
import type { AuditModel } from '../model/audit-model.js';
import type { AuditInput, AuditRecord, AuditQuery } from '../model/audit-types.js';
import { OperationsFailure } from '../../operations-failure.js';

function text(value: string | null, max: number): void {
	if (
		value !== null &&
		(!value || Buffer.byteLength(value, 'utf8') > max || Buffer.from(value, 'utf8').toString('utf8') !== value)
	) {
		throw new OperationsFailure('invalid_input');
	}
}

export class AuditService {
	constructor(private readonly model: AuditModel) {}

	append(input: AuditInput): Promise<{ record: AuditRecord; created: boolean }> {
		if (
			!OPERATION_EVENTS.includes(input.event) ||
			!Number.isSafeInteger(input.createdAt) ||
			input.createdAt < 0 ||
			(input.userId !== null && (!Number.isSafeInteger(input.userId) || input.userId < 1)) ||
			(input.statusCode !== null &&
				(!Number.isInteger(input.statusCode) || input.statusCode < 100 || input.statusCode > 599))
		) {
			throw new OperationsFailure('invalid_input');
		}
		text(input.key, 256);
		text(input.subjectId, 256);
		text(input.sourceIp, 128);
		text(input.route, 512);
		return this.model.append(input, 50000);
	}

	prune(): Promise<void> {
		return this.model.prune(50000);
	}

	async list(query: AuditQuery): Promise<{ items: AuditRecord[]; nextOffset: number | null }> {
		if (
			(query.event !== null && !OPERATION_EVENTS.includes(query.event)) ||
			[query.from, query.to].some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0)) ||
			(query.from !== null && query.to !== null && query.from > query.to) ||
			!Number.isSafeInteger(query.limit) ||
			query.limit < 1 ||
			query.limit > 200 ||
			!Number.isSafeInteger(query.offset) ||
			query.offset < 0 ||
			query.offset > 1000000
		) {
			throw new OperationsFailure('invalid_input');
		}
		text(query.q === '' ? null : query.q, 256);
		const items = await this.model.list({
			event: query.event,
			from: query.from,
			to: query.to,
			q: query.q,
			offset: query.offset,
			limit: query.limit + 1,
		});
		return {
			items: items.slice(0, query.limit),
			nextOffset: items.length > query.limit ? query.offset + query.limit : null,
		};
	}
}
