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

function classifySqliteCode(code: number | null): SqliteFailureKind {
	// node:sqlite exposes the SQLite extended result in errcode, not Error.code.
	const primaryCode = code === null ? null : code & 0xff;
	switch (primaryCode) {
		case 19:
			return 'constraint';
		case 5:
		case 6:
			return 'busy';
		default:
			return 'sql';
	}
}

export function sqliteError(value: WorkerSqliteError): SqliteFailure {
	return new SqliteFailure(classifySqliteCode(value.code), value.code, { cause: new Error(value.message) });
}
