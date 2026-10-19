import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { initializeAudit } from './audit/adapters/sqlite/audit-sql.js';
import { initializeLogging } from './logging/adapters/sqlite/logging-sql.js';
import { initializeNotifications } from './notifications/adapters/sqlite/notification-sql.js';

export async function initializeOperationsSchema(tx: SqlExecutor): Promise<void> {
	await initializeAudit(tx);
	await initializeLogging(tx);
	await initializeNotifications(tx);
}
