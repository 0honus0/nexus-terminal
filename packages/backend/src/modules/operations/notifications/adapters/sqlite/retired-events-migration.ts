import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Remove only the retired feature's records and subscriptions; keep all other audit history. */
export async function removeRetiredEvents(tx: SqlExecutor): Promise<void> {
	await tx.exec(`DELETE FROM operations_notification_deliveries WHERE event GLOB 'AGENT_*';
	DELETE FROM operations_audit WHERE event GLOB 'AGENT_*';
	UPDATE operations_notifications SET events_json=coalesce((
	 SELECT json_group_array(value) FROM json_each(operations_notifications.events_json)
	 WHERE value NOT GLOB 'AGENT_*'
	),'[]');`);
}
