import type { NotificationDeliveryOutcome } from '@nexus-terminal/shared/operations/notifications/values';
import { readAuditRecord } from '../../../audit/adapters/sqlite/audit-sql.js';
import { randomUUID } from 'node:crypto';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	NotificationStorage,
	StoredNotificationSetting,
	StoredNotificationConfig,
	StoredNotificationFanout,
	StoredNotificationDelivery,
	StoredNotificationDispatch,
} from '../../storage/notification-storage.js';
import { OperationsStorageRefusal } from '../../../operations-storage-refusal.js';
import type { StoredNotificationRecovery } from '../../storage/notification-storage.js';
import { setting, delivery, readStoredConfig } from './notification-row.js';

export async function initializeNotifications(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE operations_notifications(id TEXT PRIMARY KEY,version INTEGER NOT NULL,name TEXT NOT NULL,enabled INTEGER NOT NULL,events_json TEXT NOT NULL,config_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE operations_notification_fanout(audit_id INTEGER PRIMARY KEY REFERENCES operations_audit(id) ON DELETE CASCADE);
CREATE TABLE operations_notification_deliveries(id TEXT PRIMARY KEY,setting_id TEXT,event TEXT NOT NULL,status TEXT NOT NULL,config_json TEXT NOT NULL,subject_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX operations_delivery_pending ON operations_notification_deliveries(status,created_at);`);
}

export class SqliteNotificationStorage implements NotificationStorage {
	private identity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		this.identity = read;
	}

	private async admit(
		tx: SqlExecutor,
		digest: string,
		admit: (identity: number | null, pending: number) => void,
	): Promise<void> {
		if (!this.identity) {
			throw new Error('Operations identity reader not installed');
		}
		const pending = await tx.one(
			"SELECT COUNT(*) AS total FROM operations_notification_deliveries WHERE status IN ('queued','dispatched')",
		);
		if (!pending || typeof pending.total !== 'number' || !Number.isSafeInteger(pending.total)) {
			throw new Error('Notification pending count missing');
		}
		admit(await this.identity(tx, digest), pending.total);
	}

	list(): Promise<StoredNotificationSetting[]> {
		return this.db.transaction(async (tx) =>
			(await tx.all('SELECT * FROM operations_notifications ORDER BY id')).map(setting),
		);
	}

	mutate(
		id: string,
		digest: string,
		admit: (identity: number | null, pending: number) => void,
		change: (current: StoredNotificationSetting | null, count: number) => StoredNotificationSetting | null,
	): Promise<StoredNotificationSetting | null> {
		return this.db.transaction(async (tx) => {
			await this.admit(tx, digest, admit);
			const old = await tx.one('SELECT * FROM operations_notifications WHERE id=?', [id]);
			const count = await tx.one('SELECT COUNT(*) AS total FROM operations_notifications');
			if (!count || typeof count.total !== 'number') {
				throw new Error('Missing notification count');
			}
			const value = change(old ? setting(old) : null, count.total);
			if (value === null) {
				await tx.run('DELETE FROM operations_notifications WHERE id=?', [id]);
				await tx.run(
					"UPDATE operations_notification_deliveries SET status='failed',updated_at=? WHERE setting_id=? AND status='queued'",
					[Date.now(), id],
				);
				return null;
			}
			await tx.run(
				'INSERT INTO operations_notifications(id,version,name,enabled,events_json,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,name=excluded.name,enabled=excluded.enabled,events_json=excluded.events_json,config_json=excluded.config_json,updated_at=excluded.updated_at',
				[
					value.id,
					value.version,
					value.name,
					value.enabled ? 1 : 0,
					JSON.stringify(value.events),
					JSON.stringify(value.config),
					value.createdAt,
					value.updatedAt,
				],
			);
			return value;
		});
	}

	fanout(select: (facts: StoredNotificationFanout) => string[] | null): Promise<number> {
		return this.db.transaction(async (tx) => {
			const rows = await tx.all(
				'SELECT a.* FROM operations_audit a LEFT JOIN operations_notification_fanout f ON f.audit_id=a.id WHERE f.audit_id IS NULL ORDER BY a.id LIMIT 100',
			);
			const configs = (await tx.all('SELECT * FROM operations_notifications WHERE enabled=1')).map(setting);
			const pending = await tx.one(
				"SELECT COUNT(*) AS total FROM operations_notification_deliveries WHERE status IN ('queued','dispatched')",
			);
			if (!pending || typeof pending.total !== 'number' || !Number.isSafeInteger(pending.total)) {
				throw new Error('Notification pending count missing');
			}
			let pendingCount = pending.total;
			let processed = 0;
			for (const audit of rows) {
				const source = readAuditRecord(audit);
				const selected = select({
					event: source.event,
					createdAt: source.createdAt,
					pending: pendingCount,
					candidates: configs.map((config) => ({
						id: config.id,
						events: config.events.map((event) => event),
						createdAt: config.createdAt,
					})),
				});
				if (selected === null) {
					break;
				}
				if (
					new Set(selected).size !== selected.length ||
					selected.some((id) => !configs.some((config) => config.id === id))
				) {
					throw new Error('Invalid notification fanout decision');
				}
				pendingCount += selected.length;
				for (const config of configs) {
					if (selected.includes(config.id)) {
						await tx.run(
							'INSERT INTO operations_notification_deliveries(id,setting_id,event,status,config_json,subject_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
							[
								randomUUID(),
								config.id,
								source.event,
								'queued',
								JSON.stringify(config.config),
								source.subjectId,
								source.createdAt,
								Date.now(),
							],
						);
					}
				}
				await tx.run('INSERT INTO operations_notification_fanout(audit_id) VALUES(?)', [source.id]);
				processed++;
			}
			return processed;
		});
	}

	test(
		id: string,
		digest: string,
		admit: (identity: number | null, pending: number) => void,
		deliveryId: string,
		now: number,
	): Promise<StoredNotificationDelivery> {
		return this.db.transaction(async (tx) => {
			await this.admit(tx, digest, admit);
			const row = await tx.one('SELECT * FROM operations_notifications WHERE id=?', [id]);
			if (!row) {
				throw new OperationsStorageRefusal('not_found');
			}
			const config = setting(row);
			await tx.run(
				'INSERT INTO operations_notification_deliveries(id,setting_id,event,status,config_json,subject_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
				[deliveryId, id, 'SETTINGS_UPDATED', 'queued', JSON.stringify(config.config), null, now, now],
			);
			return {
				id: deliveryId,
				settingId: id,
				event: 'SETTINGS_UPDATED',
				status: 'queued',
				createdAt: now,
				updatedAt: now,
			};
		});
	}

	testConfig(
		id: string,
		digest: string,
		admit: (identity: number | null, pending: number) => void,
		config: StoredNotificationConfig,
		now: number,
	): Promise<StoredNotificationDelivery> {
		return this.db.transaction(async (tx) => {
			await this.admit(tx, digest, admit);
			await tx.run(
				'INSERT INTO operations_notification_deliveries(id,setting_id,event,status,config_json,subject_id,created_at,updated_at) VALUES(?,NULL,?,?,?,?,?,?)',
				[id, 'SETTINGS_UPDATED', 'queued', JSON.stringify(config), null, now, now],
			);
			return { id, settingId: null, event: 'SETTINGS_UPDATED', status: 'queued', createdAt: now, updatedAt: now };
		});
	}

	recover(command: StoredNotificationRecovery): Promise<void> {
		return this.db.transaction(async (tx) => {
			await tx.run(
				"UPDATE operations_notification_deliveries SET status='unknown',updated_at=? WHERE status='dispatched'",
				[Date.now()],
			);
			if (command.discardQueued) {
				await tx.run(
					"UPDATE operations_notification_deliveries SET status='failed',updated_at=? WHERE status='queued'",
					[Date.now()],
				);
			}
			if (command.suppressHistoricalFanout) {
				await tx.run(
					'INSERT OR IGNORE INTO operations_notification_fanout(audit_id) SELECT id FROM operations_audit',
				);
			}
		});
	}

	next(now: number): Promise<StoredNotificationDispatch | null> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				"SELECT * FROM operations_notification_deliveries WHERE status='queued' ORDER BY created_at,id LIMIT 1",
			);
			if (!row) {
				return null;
			}
			const current = delivery(row);
			const config = readStoredConfig(row.config_json);
			if (
				row.subject_id !== null &&
				(typeof row.subject_id !== 'string' ||
					Buffer.byteLength(row.subject_id, 'utf8') > 256 ||
					Buffer.from(row.subject_id, 'utf8').toString('utf8') !== row.subject_id)
			) {
				throw new Error('Corrupt notification subject');
			}
			await tx.run(
				"UPDATE operations_notification_deliveries SET status='dispatched',updated_at=? WHERE id=? AND status='queued'",
				[now, current.id],
			);
			return {
				delivery: {
					id: current.id,
					settingId: current.settingId,
					event: current.event,
					status: 'dispatched',
					createdAt: current.createdAt,
					updatedAt: now,
				},
				config,
				subjectId: row.subject_id,
			};
		});
	}

	settle(id: string, status: NotificationDeliveryOutcome, now: number, retain: number): Promise<void> {
		return this.db.transaction(async (tx) => {
			const result = await tx.run(
				"UPDATE operations_notification_deliveries SET status=?,updated_at=? WHERE id=? AND status='dispatched'",
				[status, now, id],
			);
			if (result.changes !== 1) {
				throw new OperationsStorageRefusal('version_conflict');
			}
			await tx.run(
				"DELETE FROM operations_notification_deliveries WHERE id IN (SELECT id FROM operations_notification_deliveries WHERE status IN ('sent','failed','unknown') ORDER BY updated_at DESC,id DESC LIMIT -1 OFFSET ?)",
				[retain],
			);
		});
	}

	deliveries(offset: number, limit: number): Promise<StoredNotificationDelivery[]> {
		return this.db.transaction(async (tx) =>
			(
				await tx.all(
					'SELECT * FROM operations_notification_deliveries ORDER BY created_at DESC,id LIMIT ? OFFSET ?',
					[limit, offset],
				)
			).map(delivery),
		);
	}
}
