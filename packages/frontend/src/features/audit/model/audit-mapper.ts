import type { AuditView } from '@nexus-terminal/shared/operations/audit/model';
import type { AuditEntry } from './audit-types';

export function fromAudit(value: AuditView): AuditEntry {
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
