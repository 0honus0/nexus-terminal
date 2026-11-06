import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Persist work membership so an empty delivery queue never scans completed audit history. */
export async function migrateNotificationPending(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE operations_notification_pending(
		audit_id INTEGER PRIMARY KEY REFERENCES operations_audit(id) ON DELETE CASCADE
	);
	INSERT INTO operations_notification_pending(audit_id)
	SELECT a.id FROM operations_audit a
	WHERE NOT EXISTS(SELECT 1 FROM operations_notification_fanout f WHERE f.audit_id=a.id);`);
}
