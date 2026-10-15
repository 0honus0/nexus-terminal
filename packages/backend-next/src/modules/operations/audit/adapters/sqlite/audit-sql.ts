import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	AuditStorage,
	StoredAuditInput,
	StoredAuditRecord,
	StoredAuditQuery,
} from '../../storage/audit-storage.js';
import { OPERATION_EVENTS } from '@nexus-terminal/shared/operations/values';

export async function initializeAudit(tx: SqlExecutor): Promise<void> {
	await tx.exec(
		`CREATE TABLE operations_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT NOT NULL UNIQUE,event TEXT NOT NULL,created_at INTEGER NOT NULL,user_id INTEGER,source_ip TEXT,subject_id TEXT,route TEXT,status_code INTEGER);CREATE INDEX operations_audit_time ON operations_audit(created_at,id);`,
	);
}

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		throw new Error('Corrupt audit integer');
	}
	return value;
}

function nullableText(value: unknown, max: number): string | null {
	if (value === null) {
		return null;
	}
	if (
		typeof value !== 'string' ||
		!value ||
		Buffer.byteLength(value, 'utf8') > max ||
		Buffer.from(value, 'utf8').toString('utf8') !== value
	) {
		throw new Error('Corrupt audit text');
	}
	return value;
}

export function readAuditRecord(row: Record<string, unknown>): StoredAuditRecord {
	const event = OPERATION_EVENTS.find((v) => v === row.event);
	if (!event) {
		throw new Error('Corrupt audit event');
	}
	return {
		id: integer(row.id, 1),
		event,
		createdAt: integer(row.created_at),
		userId: row.user_id === null ? null : integer(row.user_id, 1),
		sourceIp: nullableText(row.source_ip, 128),
		subjectId: nullableText(row.subject_id, 256),
		route: nullableText(row.route, 512),
		statusCode: row.status_code === null ? null : integer(row.status_code, 100, 599),
	};
}

export class SqliteAuditStorage implements AuditStorage {
	constructor(private readonly db: SqliteRuntime) {}

	append(input: StoredAuditInput, retain: number): Promise<{ record: StoredAuditRecord; created: boolean }> {
		return this.db.transaction(async (tx) => {
			const previous = await tx.one('SELECT * FROM operations_audit WHERE event_key=?', [input.key]);
			if (previous) {
				return { record: readAuditRecord(previous), created: false };
			}
			const result = await tx.run(
				'INSERT INTO operations_audit(event_key,event,created_at,user_id,source_ip,subject_id,route,status_code) VALUES(?,?,?,?,?,?,?,?)',
				[
					input.key,
					input.event,
					input.createdAt,
					input.userId,
					input.sourceIp,
					input.subjectId,
					input.route,
					input.statusCode,
				],
			);
			const row = await tx.one('SELECT * FROM operations_audit WHERE id=?', [result.lastId]);
			if (!row) {
				throw new Error('Audit event missing after insert');
			}
			await prune(tx, retain);
			return { record: readAuditRecord(row), created: true };
		});
	}

	prune(retain: number): Promise<void> {
		return this.db.transaction((tx) => prune(tx, retain));
	}

	list(query: StoredAuditQuery): Promise<StoredAuditRecord[]> {
		return this.db.transaction(async (tx) =>
			(
				await tx.all(
					"SELECT * FROM operations_audit WHERE (? IS NULL OR event=?) AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?) AND (instr(event,?)>0 OR instr(COALESCE(subject_id,''),?)>0 OR instr(COALESCE(route,''),?)>0) ORDER BY id DESC LIMIT ? OFFSET ?",
					[
						query.event,
						query.event,
						query.from,
						query.from,
						query.to,
						query.to,
						query.q,
						query.q,
						query.q,
						query.limit,
						query.offset,
					],
				)
			).map(readAuditRecord),
		);
	}
}

async function prune(tx: SqlExecutor, retain: number): Promise<void> {
	await tx.run(
		'DELETE FROM operations_audit WHERE id IN (SELECT id FROM operations_audit ORDER BY id DESC LIMIT -1 OFFSET ?) AND id IN (SELECT audit_id FROM operations_notification_fanout)',
		[retain],
	);
}
