import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import type { WorkerSqliteError } from './sqlite-errors.js';
import { decodeWorkerRequest, type WorkerRequest } from './worker-types.js';

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

function executeQuery(db: DatabaseSync, request: Exclude<WorkerRequest, { kind: 'close' }>): unknown {
	if (request.kind === 'exec') {
		db.exec(request.sql);
		return null;
	}
	const statement = db.prepare(request.sql);
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
		if (request.kind === 'close') {
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
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
port.on('message', (value: unknown) => {
	try {
		handleRequest(port, db, decodeWorkerRequest(value));
	} catch {
		// The request cannot be reliably correlated; never guess its transaction.
		port.close();
		process.exitCode = 1;
	}
});
