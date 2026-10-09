import type { WorkerSqliteError } from './sqlite-errors.js';

export type SqlParameter = string | number | null;

export type SqlRow = Record<string, unknown>;

export interface SqlRunResult {
	changes: number;
	lastId: number;
}

export interface WorkerResults {
	exec: void;
	all: SqlRow[];
	one: SqlRow | null;
	run: SqlRunResult;
	close: void;
}

export type WorkerOperation = keyof WorkerResults;

export type WorkerRequest =
	| { id: number; kind: 'close' }
	| { id: number; kind: 'exec'; sql: string }
	| { id: number; kind: 'all' | 'one' | 'run'; sql: string; params: SqlParameter[] };

export interface WorkerResponse {
	id: number;
	value?: unknown;
	error?: WorkerSqliteError;
}

function decodeRow(value: unknown): SqlRow {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Invalid SQLite worker row');
	}
	return Object.fromEntries(Object.entries(value));
}

const resultDecoders: { [K in WorkerOperation]: (value: unknown) => WorkerResults[K] } = {
	exec: () => undefined,

	close: () => undefined,

	all: (value) => {
		if (!Array.isArray(value)) {
			throw new Error('Invalid SQLite worker rows');
		}
		return value.map(decodeRow);
	},

	one: (value) => (value === null ? null : decodeRow(value)),

	run: (value) => {
		const row = decodeRow(value);
		if (typeof row.changes !== 'number' || typeof row.lastId !== 'number') {
			throw new Error('Invalid SQLite worker write result');
		}
		return { changes: row.changes, lastId: row.lastId };
	},
};

/** Decode the unknown response using the operation retained by its pending owner. */
export function decodeWorkerResult<K extends WorkerOperation>(kind: K, value: unknown): WorkerResults[K] {
	return resultDecoders[kind](value);
}
