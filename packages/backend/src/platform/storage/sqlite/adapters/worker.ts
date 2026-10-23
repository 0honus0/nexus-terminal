import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { installUnicodeTextFunctions } from './unicode-text.js';
import type { WorkerSqliteError } from '../sqlite-errors.js';
import { decodeWorkerRequest, type WorkerRequest } from '../worker-types.js';

function databasePath(value: unknown): string {
	if (typeof value !== 'object' || value === null || !('path' in value) || typeof value.path !== 'string') {
		throw new Error('Invalid SQLite worker database path');
	}
	return value.path;
}

function serializeError(error: unknown): WorkerSqliteError {
	const code = typeof error === 'object' && error !== null && 'errcode' in error ? error.errcode : null;
	return {
		message: error instanceof Error ? error.message : 'Unknown SQLite failure',
		code: typeof code === 'number' && Number.isSafeInteger(code) ? code : null,
	};
}

function executeQuery(db: DatabaseSync, request: Exclude<WorkerRequest, { kind: 'close' | 'diagnostics' }>): unknown {
	if (request.kind === 'exec') {
		// Keep hot statements across normal transactions; schema/setup scripts invalidate the cache.
		if (!['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK'].includes(request.sql)) {
			statements.clear();
		}
		db.exec(request.sql);
		return null;
	}
	let statement = statements.get(request.sql);
	if (statement) {
		statements.delete(request.sql);
	} else {
		statement = db.prepare(request.sql);
	}
	// Bound retained SQL/handles; oversized one-off queries still execute without entering the cache.
	if (request.sql.length <= 16_384) {
		if (statements.size >= 128) {
			const oldest = statements.keys().next().value;
			if (oldest !== undefined) {
				statements.delete(oldest);
			}
		}
		statements.set(request.sql, statement);
	}
	switch (request.kind) {
		case 'all':
			return statement.all(...request.params);
		case 'one':
			return statement.get(...request.params) ?? null;
		case 'run': {
			const result = statement.run(...request.params);
			const changes = Number(result.changes);
			const lastId = Number(result.lastInsertRowid);
			if (!Number.isSafeInteger(changes) || changes < 0 || !Number.isSafeInteger(lastId)) {
				throw new Error('SQLite result outside safe integer range');
			}
			return { changes, lastId };
		}
		default:
			throw new Error('Unsupported SQLite worker operation');
	}
}

function handleRequest(port: MessagePort, db: DatabaseSync, request: WorkerRequest): void {
	try {
		if (request.kind === 'diagnostics') {
			const memory = process.memoryUsage();
			port.postMessage({
				id: request.id,
				value: {
					heapUsedBytes: memory.heapUsed,
					heapTotalBytes: memory.heapTotal,
					externalBytes: memory.external,
					arrayBufferBytes: memory.arrayBuffers,
				},
			});
			return;
		}
		if (request.kind === 'close') {
			statements.clear();
			db.close();
			port.postMessage({ id: request.id, value: null });
			port.close();
			return;
		}
		const value = executeQuery(db, request);
		port.postMessage({ id: request.id, value });
	} catch (error) {
		port.postMessage({ id: request.id, error: serializeError(error) });
	}
}

const port = parentPort;
if (port === null) {
	throw new Error('SQLite worker requires a parent port');
}
const db = new DatabaseSync(databasePath(workerData));
const statements = new Map<string, StatementSync>();
installUnicodeTextFunctions(db);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000');
port.on('message', (value: unknown) => {
	try {
		handleRequest(port, db, decodeWorkerRequest(value));
	} catch {
		// The request cannot be reliably correlated; never guess its transaction.
		port.close();
		process.exitCode = 1;
	}
});
