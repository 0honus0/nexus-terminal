export const SQLITE_CONSTRAINT_FOREIGNKEY = 787;

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
		readonly sqliteCode: number | null = null,
		options?: ErrorOptions,
	) {
		super('SQLite ' + kind, options);
		this.name = 'SqliteFailure';
	}
}

export interface WorkerSqliteError {
	message: string;
	code: number | null;
}

export function sqliteError(value: WorkerSqliteError): SqliteFailure {
	const code = value.code;
	// node:sqlite exposes the SQLite extended result in errcode, not Error.code.
	const primaryCode = code === null ? null : code & 0xff;
	const kind: SqliteFailureKind =
		primaryCode === 19 ? 'constraint' : primaryCode === 5 || primaryCode === 6 ? 'busy' : 'sql';
	return new SqliteFailure(kind, code, { cause: new Error(value.message) });
}
