import type { AuditEntry } from './audit-types';

export function auditSummary(log: AuditEntry): string {
	return [log.subjectId, log.route, log.sourceIp].filter((value) => value !== null && value !== '').join(' · ');
}
