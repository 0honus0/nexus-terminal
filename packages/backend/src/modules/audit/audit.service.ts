import type { AuditLogActionType } from './audit.types';
import type { AuditLogRepository } from './audit.repository.port';
import { logger, logErrorCode } from '../../shared/logging/logger';

export class AuditLogService {
	constructor(private readonly repository: AuditLogRepository) {}

	async logAction(actionType: AuditLogActionType, details?: Record<string, unknown> | string | null): Promise<void> {
		try {
			await this.repository.add(actionType, details);
		} catch (error) {
			logger.error(
				{ actionType, errorCode: logErrorCode(error, 'AUDIT_WRITE_FAILED') },
				'Audit record could not be persisted',
			);
		}
	}

	getLogs(
		limit = 50,
		offset = 0,
		actionType?: AuditLogActionType,
		startDate?: number,
		endDate?: number,
		searchTerm?: string,
	) {
		return this.repository.list({ limit, offset, actionType, startDate, endDate, searchTerm });
	}
}
