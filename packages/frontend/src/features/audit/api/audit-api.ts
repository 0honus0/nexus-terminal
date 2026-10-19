import { readAuditQuery, readAuditResponse } from '@nexus-terminal/shared/operations/http-codec';
import { requestOperation, OperationsRequestFailure } from '@/client/operations/operations-request';
import { fromAudit } from '../model/audit-mapper';
import type { AuditPage, AuditQuery } from '../model/audit-types';

export const auditApi = {
	async list(query: AuditQuery = {}, signal?: AbortSignal): Promise<AuditPage> {
		const params = new URLSearchParams();
		for (const key of ['event', 'from', 'to', 'q', 'offset', 'limit'] as const) {
			const value = query[key];
			if (value !== undefined && value !== null && value !== '') {
				params.set(key, String(value));
			}
		}
		let context;
		try {
			context = readAuditQuery(params);
		} catch (cause) {
			throw new OperationsRequestFailure('invalid_input', 'not_dispatched', { cause });
		}
		const page = await requestOperation({
			path: '/settings/audit-logs?' + params.toString(),
			method: 'GET',
			decode: readAuditResponse,
			signal,
		});
		const expectedOffset = context.offset + page.items.length;
		const invalid =
			page.items.length > context.limit ||
			(page.nextOffset !== null && (page.items.length !== context.limit || page.nextOffset !== expectedOffset)) ||
			page.items.some(
				(item, index) =>
					Number.isNaN(new Date(item.createdAt).getTime()) ||
					(context.event !== null && item.event !== context.event) ||
					(context.from !== null && item.createdAt < context.from) ||
					(context.to !== null && item.createdAt > context.to) ||
					(index > 0 && item.id >= (page.items[index - 1]?.id ?? 0)),
			);
		if (invalid) {
			throw new OperationsRequestFailure('protocol_failure', 'unknown');
		}
		return { items: page.items.map(fromAudit), nextOffset: page.nextOffset };
	},
};
