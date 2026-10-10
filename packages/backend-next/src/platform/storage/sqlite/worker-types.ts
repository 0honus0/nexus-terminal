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

function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid SQLite worker envelope');
	}
	return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): void {
	if (Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) {
		throw new Error('Invalid SQLite worker fields');
	}
}

function id(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new Error('Invalid SQLite worker id');
	}
	return value;
}

export function decodeWorkerRequest(value: unknown): WorkerRequest {
	const row = object(value);
	const requestId = id(row.id);
	switch (row.kind) {
		case 'close':
			fields(row, ['id', 'kind'], ['id', 'kind']);
			return { id: requestId, kind: 'close' };
		case 'exec':
			fields(row, ['id', 'kind', 'sql'], ['id', 'kind', 'sql']);
			if (typeof row.sql !== 'string' || !row.sql.trim()) throw new Error('Invalid SQLite SQL');
			return { id: requestId, kind: 'exec', sql: row.sql };
		case 'all':
		case 'one':
		case 'run':
			fields(row, ['id', 'kind', 'sql', 'params'], ['id', 'kind', 'sql', 'params']);
			if (typeof row.sql !== 'string' || !row.sql.trim() || !Array.isArray(row.params)) {
				throw new Error('Invalid SQLite query');
			}
			const params: SqlParameter[] = row.params.map((item: unknown) => {
				if (item === null || typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item))) {
					return item;
				}
				throw new Error('Invalid SQLite parameter');
			});
			return { id: requestId, kind: row.kind, sql: row.sql, params };
		default:
			throw new Error('Invalid SQLite worker operation');
	}
}

export function decodeWorkerResponse(value: unknown): WorkerResponse {
	const row = object(value);
	const responseId = id(row.id);
	if (Object.hasOwn(row, 'error')) {
		fields(row, ['id', 'error'], ['id', 'error']);
		const error = object(row.error);
		fields(error, ['message', 'code'], ['message', 'code']);
		if (
			typeof error.message !== 'string' ||
			!(error.code === null || (typeof error.code === 'number' && Number.isSafeInteger(error.code) && error.code >= 0))
		) {
			throw new Error('Invalid SQLite worker error');
		}
		return { id: responseId, error: { message: error.message, code: error.code } };
	}
	fields(row, ['id', 'value'], ['id', 'value']);
	return { id: responseId, value: row.value };
}

function decodeRow(value: unknown): SqlRow {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Invalid SQLite worker row');
	}
	const result: SqlRow = Object.create(null) as SqlRow;
	for (const [name, cell] of Object.entries(value)) {
		if (
			cell !== null &&
			typeof cell !== 'string' &&
			!(typeof cell === 'number' && Number.isFinite(cell)) &&
			!(cell instanceof Uint8Array)
		) {
			throw new Error('Invalid SQLite worker cell');
		}
		result[name] = cell instanceof Uint8Array ? Uint8Array.from(cell) : cell;
	}
	return result;
}

const resultDecoders: { [K in WorkerOperation]: (value: unknown) => WorkerResults[K] } = {
	exec: (value) => {
		if (value !== null) throw new Error('Invalid SQLite exec acknowledgment');
	},

	close: (value) => {
		if (value !== null) throw new Error('Invalid SQLite close acknowledgment');
	},

	all: (value) => {
		if (!Array.isArray(value)) {
			throw new Error('Invalid SQLite worker rows');
		}
		return value.map(decodeRow);
	},

	one: (value) => (value === null ? null : decodeRow(value)),

	run: (value) => {
		const row = decodeRow(value);
		if (
			Object.keys(row).length !== 2 ||
			typeof row.changes !== 'number' || !Number.isSafeInteger(row.changes) || row.changes < 0 ||
			typeof row.lastId !== 'number' || !Number.isSafeInteger(row.lastId)
		) {
			throw new Error('Invalid SQLite worker write result');
		}
		return { changes: row.changes, lastId: row.lastId };
	},
};

/** Decode the unknown response using the operation retained by its pending owner. */
export function decodeWorkerResult<K extends WorkerOperation>(kind: K, value: unknown): WorkerResults[K] {
	return resultDecoders[kind](value);
}
