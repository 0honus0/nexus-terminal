import type { Logger } from '../../logging/logger.js';
import { logDiagnostic } from '../../logging/diagnostic-log.js';
import type { SqlExecutor } from './sql-types.js';
import { SqliteTransactionAdapter } from './adapters/transaction-sql.js';
import { Worker } from 'node:worker_threads';
import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SqliteFailure, sqliteError } from './sqlite-errors.js';
import {
	decodeWorkerResult,
	decodeWorkerResponse,
	type SqlParameter,
	type SqlRow,
	type SqlRunResult,
	type WorkerOperation,
	type WorkerResults,
	type SqliteWorkerMemory,
} from './worker-types.js';

interface PendingCall {
	resolve(value: unknown): void;
	reject(error: Error): void;
}

type TransactionOutcome<T> = { status: 'ok'; value: T } | { status: 'error'; error: unknown };

interface TransactionAdmissionScope {
	active: boolean;
	admissions: readonly ((tx: SqlExecutor) => Promise<void>)[];
}

const openDatabasePaths = new Set<string>();

export class SqliteRuntime implements SqlExecutor {
	private readonly worker: Worker;
	private readonly pending = new Map<number, PendingCall>();
	private nextId = 0;
	private pendingOperations = 0;
	private diagnosticReading: Promise<SqliteWorkerMemory> | null = null;

	private tail: Promise<unknown> = Promise.resolve();
	private closePromise: Promise<void> | null = null;
	private unavailable: SqliteFailure | null = null;
	private closed = false;
	private readonly transactionScope = new AsyncLocalStorage<boolean>();
	private readonly admissionScope = new AsyncLocalStorage<TransactionAdmissionScope>();
	private readonly directExecutor: SqlExecutor = {
		exec: (sql) => this.call('exec', sql),

		one: (sql, params = []) => this.call('one', sql, params),

		all: (sql, params = []) => this.call('all', sql, params),

		run: (sql, params = []) => this.call('run', sql, params),
	};
	private readonly transactions = new SqliteTransactionAdapter(this.directExecutor);

	private constructor(
		readonly path: string,
		private readonly logger?: Logger,
	) {
		this.worker = new Worker(new URL('./adapters/worker.js', import.meta.url), { workerData: { path } });
		this.worker.on('message', (message: unknown) => this.handleWorkerResponse(message));
		this.worker.on('error', (error) =>
			this.markUnavailable(new SqliteFailure('worker_exit', null, { cause: error })),
		);
		this.worker.on('exit', (code) => {
			if (!this.closed) {
				this.markUnavailable(new SqliteFailure('worker_exit', null, { cause: new Error('exit ' + code) }));
			}
		});
	}

	private handleWorkerResponse(raw: unknown): void {
		let message: ReturnType<typeof decodeWorkerResponse>;
		try {
			message = decodeWorkerResponse(raw);
		} catch (cause) {
			this.markUnavailable(new SqliteFailure('worker_exit', null, { cause }));
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			this.markUnavailable(
				new SqliteFailure('worker_exit', null, {
					cause: new Error('Unexpected SQLite worker response'),
				}),
			);
			return;
		}
		this.pending.delete(message.id);
		if (message.error !== undefined) {
			pending.reject(sqliteError(message.error));
		} else {
			pending.resolve(message.value);
		}
	}

	getPendingRequestCount(): number {
		return this.pending.size;
	}

	getPendingOperationCount(): number {
		return this.pendingOperations;
	}

	getWorkerMemory(): Promise<SqliteWorkerMemory> {
		if (this.closePromise) {
			return Promise.reject(new SqliteFailure('closed'));
		}
		if (this.diagnosticReading) {
			return this.diagnosticReading;
		}
		const reading = this.call('diagnostics');
		this.diagnosticReading = reading;
		void reading.then(
			() => {
				if (this.diagnosticReading === reading) {
					this.diagnosticReading = null;
				}
			},
			() => {
				if (this.diagnosticReading === reading) {
					this.diagnosticReading = null;
				}
			},
		);
		return reading;
	}

	static open(path: string, logger?: Logger): SqliteRuntime {
		if (path === ':memory:') {
			throw new Error('Use a dedicated on-disk test database');
		}
		const absolute = resolve(path);
		mkdirSync(dirname(absolute), { recursive: true });
		const canonical = resolve(realpathSync(dirname(absolute)), absolute.slice(dirname(absolute).length + 1));
		if (openDatabasePaths.has(canonical)) {
			throw new SqliteFailure('unavailable');
		}
		openDatabasePaths.add(canonical);
		try {
			return new SqliteRuntime(canonical, logger);
		} catch (error) {
			openDatabasePaths.delete(canonical);
			throw error;
		}
	}

	/** Isolated production preflight; never aliases an on-disk application database. */
	static openMemory(): SqliteRuntime {
		return new SqliteRuntime(':memory:');
	}

	private markUnavailable(error: SqliteFailure): void {
		if (this.unavailable) {
			return;
		}
		logDiagnostic(
			this.logger,
			'error',
			'DATABASE_WORKER_UNAVAILABLE',
			{ pendingRequests: this.pending.size },
			error,
		);
		this.unavailable = error;
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
	}

	private call<K extends WorkerOperation>(kind: K, sql?: string, params?: SqlParameter[]): Promise<WorkerResults[K]> {
		return new Promise((resolve, reject) => {
			if (this.unavailable) {
				return reject(this.unavailable);
			}
			if (this.closed) {
				return reject(new SqliteFailure('closed'));
			}
			const id = ++this.nextId;
			if (!Number.isSafeInteger(id)) {
				const failure = new SqliteFailure('worker_exit', null, {
					cause: new Error('SQLite request ID exhausted'),
				});
				this.markUnavailable(failure);
				return reject(failure);
			}
			this.pending.set(id, {
				resolve: (value) => {
					try {
						resolve(decodeWorkerResult(kind, value));
					} catch (cause) {
						const failure = new SqliteFailure('worker_exit', null, { cause });
						this.markUnavailable(failure);
						reject(failure);
					}
				},

				reject,
			});
			try {
				const request =
					kind === 'close' || kind === 'diagnostics'
						? { id, kind }
						: kind === 'exec'
							? { id, kind, sql }
							: { id, kind, sql, params };
				this.worker.postMessage(request);
			} catch (error) {
				this.pending.delete(id);
				reject(new SqliteFailure('sql', null, { cause: error }));
			}
		});
	}

	private enqueue<T>(work: () => Promise<T>): Promise<T> {
		if (this.transactionScope.getStore()) {
			return Promise.reject(
				new SqliteFailure('transaction', null, {
					cause: new Error('Use only the transaction executor inside a transaction'),
				}),
			);
		}
		if (this.closePromise) {
			return Promise.reject(new SqliteFailure('closed'));
		}
		if (this.unavailable) {
			return Promise.reject(this.unavailable);
		}
		this.pendingOperations++;
		const result = this.tail.then(work).finally(() => {
			this.pendingOperations--;
		});
		this.tail = result.catch(() => undefined);
		return result;
	}

	all(sql: string, params: SqlParameter[] = []): Promise<SqlRow[]> {
		return this.readOrWrite(
			(tx) => tx.all(sql, params),
			() => this.call('all', sql, params),
		);
	}

	one(sql: string, params: SqlParameter[] = []): Promise<SqlRow | null> {
		return this.readOrWrite(
			(tx) => tx.one(sql, params),
			() => this.call('one', sql, params),
		);
	}

	run(sql: string, params: SqlParameter[] = []): Promise<SqlRunResult> {
		return this.readOrWrite(
			(tx) => tx.run(sql, params),
			() => this.call('run', sql, params),
		);
	}

	exec(sql: string): Promise<void> {
		return this.readOrWrite(
			(tx) => tx.exec(sql),
			() => this.call('exec', sql),
		);
	}

	/** Enqueued operations capture admission before waiting; checks run inside their actual transaction.
	 * Completed scopes do not become the authority of separately owned background work.
	 */
	async withTransactionAdmission<T>(admit: (tx: SqlExecutor) => Promise<void>, work: () => Promise<T>): Promise<T> {
		if (this.transactionScope.getStore()) {
			throw new SqliteFailure('transaction');
		}
		const parent = this.admissionScope.getStore();
		const scope: TransactionAdmissionScope = {
			active: true,
			admissions: [...(parent?.active ? parent.admissions : []), admit],
		};
		try {
			return await this.admissionScope.run(scope, work);
		} finally {
			scope.active = false;
		}
	}

	private admissions(): readonly ((tx: SqlExecutor) => Promise<void>)[] {
		const scope = this.admissionScope.getStore();
		return scope?.active ? scope.admissions : [];
	}

	/** Transfer a separately owned task out of the caller's temporary admission scope. */
	withoutTransactionAdmission<T>(work: () => Promise<T>): Promise<T> {
		if (this.transactionScope.getStore()) {
			throw new SqliteFailure('transaction');
		}
		return this.admissionScope.run({ active: false, admissions: [] }, () => Promise.resolve().then(work));
	}

	private readOrWrite<T>(work: (tx: SqlExecutor) => Promise<T>, direct: () => Promise<T>): Promise<T> {
		const admissions = this.admissions();
		return this.enqueue(admissions.length ? () => this.runTransaction(work, admissions) : direct);
	}

	transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
		const admissions = this.admissions();
		return this.enqueue(() => this.runTransaction(work, admissions));
	}

	private async runTransaction<T>(
		work: (tx: SqlExecutor) => Promise<T>,
		admissions: readonly ((tx: SqlExecutor) => Promise<void>)[],
	): Promise<T> {
		await this.transactions.begin();
		let active = true;
		const operations = new Set<Promise<unknown>>();

		const withinTransaction = <K extends WorkerOperation>(
			kind: K,
			sql: string,
			params: SqlParameter[],
		): Promise<WorkerResults[K]> => {
			if (!active) {
				return Promise.reject(new SqliteFailure('transaction'));
			}
			const task = this.call(kind, sql, params);
			operations.add(task);
			void task.then(
				() => operations.delete(task),
				() => operations.delete(task),
			);
			return task;
		};

		const tx: SqlExecutor = {
			exec: (sql) => withinTransaction('exec', sql, []),

			all: (sql, params = []) => withinTransaction('all', sql, params),

			one: (sql, params = []) => withinTransaction('one', sql, params),

			run: (sql, params = []) => withinTransaction('run', sql, params),
		};
		let outcome: TransactionOutcome<T>;
		try {
			const value = await this.transactionScope.run(true, async () => {
				for (const admit of admissions) {
					await admit(tx);
				}
				const value = await work(tx);
				for (const admit of admissions) {
					await admit(tx);
				}
				return value;
			});
			outcome = { status: 'ok', value };
		} catch (error) {
			outcome = { status: 'error', error };
		}
		active = false;
		if (operations.size) {
			const pending = [...operations];
			await Promise.allSettled(pending);
			if (outcome.status === 'ok') {
				const cause = new Error('Unawaited transaction operations');
				outcome = { status: 'error', error: new SqliteFailure('transaction', null, { cause }) };
			}
		}
		if (outcome.status === 'error') {
			return this.rollbackAndThrow(outcome.error);
		}
		await this.commit();
		return outcome.value;
	}

	private async rollbackAndThrow(callbackError: unknown): Promise<never> {
		try {
			await this.transactions.rollback();
		} catch (rollbackError) {
			const cause = new AggregateError([callbackError, rollbackError], 'Transaction and rollback both failed');
			const failure = new SqliteFailure('rollback_failed', null, { cause });
			this.markUnavailable(failure);
			throw failure;
		}
		throw callbackError;
	}

	private async commit(): Promise<void> {
		try {
			await this.transactions.commit();
		} catch (error) {
			const failure = new SqliteFailure('commit_unknown', null, { cause: error });
			this.markUnavailable(failure);
			throw failure;
		}
	}

	close(): Promise<void> {
		if (this.transactionScope.getStore()) {
			return Promise.reject(
				new SqliteFailure('transaction', null, {
					cause: new Error('Cannot close from an active transaction'),
				}),
			);
		}
		if (this.closePromise) {
			return this.closePromise;
		}
		this.closePromise = Promise.resolve().then(() => this.closeResources());
		return this.closePromise;
	}

	private async closeResources(): Promise<void> {
		let failure: unknown = null;
		try {
			await this.tail;
			if (this.unavailable) {
				throw this.unavailable;
			}
			await this.call('close');
		} catch (error) {
			failure = error;
		} finally {
			this.closed = true;
			try {
				await this.worker.terminate();
			} catch (error) {
				failure =
					failure === null
						? error
						: new AggregateError([failure, error], 'SQLite close and termination failed');
			}
			openDatabasePaths.delete(this.path);
		}
		if (failure !== null) {
			throw failure;
		}
	}
}
