import { operationsStorage } from '../../operations-storage-failure.js';
import type { AuditStorage, StoredAuditRecord } from '../storage/audit-storage.js';
import type { AuditInput, AuditRecord, AuditQuery } from './audit-types.js';

function fromStorage(value: StoredAuditRecord): AuditRecord {
	return {
		id: value.id,
		event: value.event,
		createdAt: value.createdAt,
		userId: value.userId,
		sourceIp: value.sourceIp,
		subjectId: value.subjectId,
		route: value.route,
		statusCode: value.statusCode,
	};
}

export class AuditModel {
	constructor(private readonly storage: AuditStorage) {}

	async append(input: AuditInput, retain: number): Promise<{ record: AuditRecord; created: boolean }> {
		const value = await operationsStorage(() =>
			this.storage.append(
				{
					key: input.key,
					event: input.event,
					createdAt: input.createdAt,
					userId: input.userId,
					sourceIp: input.sourceIp,
					subjectId: input.subjectId,
					route: input.route,
					statusCode: input.statusCode,
				},
				retain,
			),
		);
		return { record: fromStorage(value.record), created: value.created };
	}

	prune(retain: number): Promise<void> {
		return operationsStorage(() => this.storage.prune(retain));
	}

	async list(query: AuditQuery): Promise<AuditRecord[]> {
		return (
			await operationsStorage(() =>
				this.storage.list({
					event: query.event,
					from: query.from,
					to: query.to,
					q: query.q,
					offset: query.offset,
					limit: query.limit,
				}),
			)
		).map(fromStorage);
	}
}
