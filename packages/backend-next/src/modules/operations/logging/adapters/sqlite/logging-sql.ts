import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { LoggingStorage, StoredLogging } from '../../storage/logging-storage.js';
import type { BackendLogLevel } from '@nexus-terminal/shared/operations/logging/values';
import { BACKEND_LOG_LEVELS } from '@nexus-terminal/shared/operations/logging/values';
import { OperationsStorageRefusal } from '../../../operations-storage-refusal.js';

export async function initializeLogging(tx: SqlExecutor): Promise<void> {
	await tx.exec(
		'CREATE TABLE operations_logging(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,level TEXT NOT NULL,updated_at INTEGER NOT NULL)',
	);
}

export function readLoggingRow(value: Record<string, unknown>): StoredLogging {
	const level = BACKEND_LOG_LEVELS.find((l) => l === value.level);
	if (
		!level ||
		typeof value.version !== 'number' ||
		!Number.isSafeInteger(value.version) ||
		value.version < 1 ||
		typeof value.updated_at !== 'number' ||
		!Number.isSafeInteger(value.updated_at) ||
		value.updated_at < 0
	) {
		throw new Error('Corrupt logging settings');
	}
	return { version: value.version, level, updatedAt: value.updated_at };
}

export class SqliteLoggingStorage implements LoggingStorage {
	private identity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		this.identity = read;
	}

	get(): Promise<StoredLogging | null> {
		return this.db.transaction(async (tx) => {
			const value = await tx.one('SELECT * FROM operations_logging WHERE id=1');
			return value ? readLoggingRow(value) : null;
		});
	}

	update(
		version: number,
		level: BackendLogLevel,
		now: number,
		admit: (userId: number | null) => void,
		digest: string,
	): Promise<StoredLogging> {
		return this.db.transaction(async (tx) => {
			if (!this.identity) {
				throw new Error('Operations identity reader not installed');
			}
			admit(await this.identity(tx, digest));
			const previous = await tx.one('SELECT * FROM operations_logging WHERE id=1');
			if ((previous ? readLoggingRow(previous).version : 0) !== version) {
				throw new OperationsStorageRefusal('version_conflict');
			}
			await tx.run(
				'INSERT INTO operations_logging(id,version,level,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,level=excluded.level,updated_at=excluded.updated_at',
				[version + 1, level, now],
			);
			return { version: version + 1, level, updatedAt: now };
		});
	}
}
