import type { SnapshotRegistration, SnapshotTable } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import type { SecretBox } from '../../../../../platform/security/secret-box.js';
import {
	transferSnapshotRow,
	restoreSnapshotRow,
} from '../../../../../platform/storage/sqlite/adapters/snapshot-row.js';
import {
	transferNotificationSnapshot,
	restoreNotificationSnapshot,
} from '../../../notifications/adapters/sqlite/notification-snapshot.js';
import { setting, delivery } from '../../../notifications/adapters/sqlite/notification-row.js';
import { readAuditRecord } from '../../../audit/adapters/sqlite/audit-sql.js';
import { readLoggingRow } from '../../../logging/adapters/sqlite/logging-sql.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';

/** Fixed current table/column coverage owned by operations; no runtime schema discovery. */
export function registerOperationsSnapshot(secrets: SecretBox | null): SnapshotRegistration {
	const tables: SnapshotTable[] = [
		{
			name: 'operations_audit',
			partitionColumn: 'user_id',
			allowNullPartition: true,
			columns: [
				'id',
				'event_key',
				'event',
				'created_at',
				'user_id',
				'source_ip',
				'subject_id',
				'route',
				'status_code',
			],
		},
		{ name: 'operations_logging', columns: ['id', 'version', 'level', 'updated_at'] },
		{
			name: 'operations_notifications',
			columns: ['id', 'version', 'name', 'enabled', 'events_json', 'config_json', 'created_at', 'updated_at'],
		},
		{ name: 'operations_notification_fanout', columns: ['audit_id'] },
		{
			name: 'operations_notification_deliveries',
			columns: ['id', 'setting_id', 'event', 'status', 'config_json', 'subject_id', 'created_at', 'updated_at'],
		},
	];
	return {
		tables,

		validate(rows) {
			const logging = rows.get('operations_logging') ?? [];
			if (logging.length !== 1 || logging[0].id !== 1) {
				throw new SnapshotFailure('unavailable');
			}
			for (const row of rows.get('operations_audit') ?? []) {
				readAuditRecord(row);
			}
			for (const row of rows.get('operations_logging') ?? []) {
				readLoggingRow(row);
			}
			for (const row of rows.get('operations_notifications') ?? []) {
				setting(row);
			}
			for (const row of rows.get('operations_notification_deliveries') ?? []) {
				delivery(row);
			}
		},

		transfer(table, row) {
			if (table.name === 'operations_notifications' || table.name === 'operations_notification_deliveries') {
				return transferNotificationSnapshot(
					row,
					table.columns,
					table.name === 'operations_notification_deliveries',
					secrets,
				);
			}
			const scopes = new Map<string, string>();
			return transferSnapshotRow(row, table.columns, scopes, secrets);
		},

		restore(table, row) {
			if (table.name === 'operations_notifications' || table.name === 'operations_notification_deliveries') {
				return restoreNotificationSnapshot(
					row,
					table.columns,
					table.name === 'operations_notification_deliveries',
					secrets,
				);
			}
			return restoreSnapshotRow(row, table.columns, new Map(), secrets);
		},

		files() {
			return [];
		},
	};
}
