/** Stable technical error contract; business modules decide how to expose it. */
export type SqliteFailureKind =
	| 'closed'
	| 'unavailable'
	| 'worker_exit'
	| 'constraint'
	| 'busy'
	| 'sql'
	| 'transaction'
	| 'commit_unknown'
	| 'rollback_failed';

export class SqliteFailure extends Error {
	constructor(
		readonly kind: SqliteFailureKind,
		readonly sqliteCode: string | null = null,
		options?: ErrorOptions,
	) {
		super('SQLite ' + kind, options);
		this.name = 'SqliteFailure';
	}
}

export interface WorkerSqliteError {
	message: string;
	code: string | null;
}

export function sqliteError(value: WorkerSqliteError): SqliteFailure {
	const code = value.code;
	const kind: SqliteFailureKind = code?.startsWith('SQLITE_CONSTRAINT')
		? 'constraint'
		: code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED'
			? 'busy'
			: 'sql';
	return new SqliteFailure(kind, code, { cause: new Error(value.message) });
}
