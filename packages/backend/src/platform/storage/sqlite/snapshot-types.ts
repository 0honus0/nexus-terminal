import type { SqlParameter, SqlRow } from './worker-types.js';
import type { SqlReader } from './sql-types.js';

export interface SnapshotTable {
	name: string;
	columns: readonly string[];
	/** Owner-declared tenant/partition column, checked against trusted destination context on import. */
	partitionColumn?: string;
	allowNullPartition?: boolean;
}

export interface SnapshotFileReference {
	root: string;
	key: string;
	bytes: number;
	sha256: string;
}

export interface SnapshotRegistration {
	tables: readonly SnapshotTable[];
	/** Owned, intentionally omitted technical caches; omissions are checked against the live schema. */
	excludedTables?: readonly string[];
	/** Must return every registered column; ciphertext conversion belongs to the registering owner. */
	transfer(table: SnapshotTable, row: SqlRow): SqlRow;
	/** Decode transfer rows and protect secrets using the destination instance. No live writes. */
	restore(table: SnapshotTable, row: SqlRow): SqlRow;
	files(table: string, row: SqlRow): readonly SnapshotFileReference[];
	validate?(tables: ReadonlyMap<string, readonly SqlRow[]>): void;
	/** Adapter-owned joined decoders run against the isolated candidate database, never live facts. */
	validateStorage?(
		reader: SqlReader,
		tables: ReadonlyMap<string, readonly SqlRow[]>,
		signal: AbortSignal,
	): Promise<void>;
	validateFile?(
		ref: SnapshotFileReference,
		bytes: Uint8Array,
		tables: ReadonlyMap<string, readonly SqlRow[]>,
	): Promise<void>;
}

export interface SnapshotCollector {
	collect(signal: AbortSignal): Promise<Uint8Array>;
	/** Preflight creates a one-use resource without changing live data or content roots. */
	prepareImport(bytes: Uint8Array, partition: SqlParameter, signal: AbortSignal): Promise<PreparedSnapshot>;
}

export interface SnapshotRestoreReceipt {
	restoredTables: number;
	restoredRows: number;
	restoredFiles: number;
	cleanupPending: boolean;
}

/** One-use validated resource; raw tables, files and secrets remain inside the Adapter. */
export interface PreparedSnapshot {
	commit(signal: AbortSignal): Promise<SnapshotRestoreReceipt>;
	close(): void;
}

export class SnapshotFailure extends Error {
	constructor(
		readonly kind:
			| 'invalid_registration'
			| 'invalid_archive'
			| 'limit_exceeded'
			| 'source_changed'
			| 'unavailable'
			| 'commit_unknown'
			| 'cleanup_failed',
		options?: ErrorOptions,
	) {
		super('Snapshot failed: ' + kind, options);
		this.name = 'SnapshotFailure';
	}
}
