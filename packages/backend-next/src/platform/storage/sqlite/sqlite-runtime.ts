import { Worker } from 'node:worker_threads';
import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SqliteFailure, sqliteError, type WorkerSqliteError } from './sqlite-errors.js';

type Param = string | number | null;
type Row = Record<string, unknown>;
type Run = { changes: number; lastId: number };

export interface SqlExecutor {
	exec(sql: string): Promise<void>;
	all(sql: string, params?: Param[]): Promise<Row[]>;
	one(sql: string, params?: Param[]): Promise<Row | null>;
	run(sql: string, params?: Param[]): Promise<Run>;
}

const paths = new Set<string>();

export class SqliteRuntime implements SqlExecutor {
	private readonly worker: Worker;
	private readonly pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
	private nextId = 0;
	private tail: Promise<unknown> = Promise.resolve();
	private closePromise: Promise<void> | null = null;
	private unavailable: SqliteFailure | null = null;
	private closed = false;
	private readonly transactionScope = new AsyncLocalStorage<boolean>();

	private constructor(readonly path: string) {
		this.worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: { path } });
		this.worker.on('message', (message: { id: number; value?: any; error?: WorkerSqliteError }) => {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			if (message.error) pending.reject(sqliteError(message.error));
			else pending.resolve(message.value);
		});
		this.worker.on('error', (error) => this.poison(new SqliteFailure('worker_exit', null, { cause: error })));
		this.worker.on('exit', (code) => {
			if (!this.closed) this.poison(new SqliteFailure('worker_exit', null, { cause: new Error('exit ' + code) }));
		});
	}

	static open(path: string): SqliteRuntime {
		if (path === ':memory:') throw new Error('Use a dedicated on-disk test database');
		const absolute = resolve(path);
		mkdirSync(dirname(absolute), { recursive: true });
		const canonical = resolve(realpathSync(dirname(absolute)), absolute.slice(dirname(absolute).length + 1));
		if (paths.has(canonical)) throw new SqliteFailure('unavailable');
		paths.add(canonical);
		try {
			return new SqliteRuntime(canonical);
		} catch (error) {
			paths.delete(canonical);
			throw error;
		}
	}

	private poison(error: SqliteFailure): void {
		if (this.unavailable) return;
		this.unavailable = error;
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}

	private call<T>(kind: string, sql?: string, params?: Param[]): Promise<T> {
		return new Promise((resolve, reject) => {
			if (this.unavailable) return reject(this.unavailable);
			if (this.closed) return reject(new SqliteFailure('closed'));
			const id = ++this.nextId;
			this.pending.set(id, { resolve, reject });
			try {
				this.worker.postMessage({ id, kind, sql, params });
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
		if (this.closePromise) return Promise.reject(new SqliteFailure('closed'));
		if (this.unavailable) return Promise.reject(this.unavailable);
		const result = this.tail.then(work);
		this.tail = result.catch(() => undefined);
		return result;
	}

	all(sql: string, params: Param[] = []): Promise<Row[]> {
		return this.enqueue(() => this.call('all', sql, params));
	}

	one(sql: string, params: Param[] = []): Promise<Row | null> {
		return this.enqueue(() => this.call('one', sql, params));
	}

	run(sql: string, params: Param[] = []): Promise<Run> {
		return this.enqueue(() => this.call('run', sql, params));
	}

	exec(sql: string): Promise<void> {
		return this.enqueue(() => this.call('exec', sql));
	}

	transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
		return this.enqueue(async () => {
			await this.call('exec', 'BEGIN IMMEDIATE');
			let active = true;
			const operations = new Set<Promise<unknown>>();

			const withinTransaction = <R>(kind: string, sql: string, params: Param[]): Promise<R> => {
				if (!active) return Promise.reject(new SqliteFailure('transaction'));
				const task = this.call<R>(kind, sql, params);
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
			let result: T;
			let callbackError: unknown = null;
			let callbackFailed = false;
			try {
				result = await this.transactionScope.run(true, () => work(tx));
			} catch (error) {
				callbackFailed = true;
				callbackError = error;
			}
			active = false;
			if (operations.size) {
				const pending = [...operations];
				await Promise.allSettled(pending);
				if (!callbackFailed) {
					callbackFailed = true;
					callbackError = new SqliteFailure('transaction', null, {
						cause: new Error('Unawaited transaction operations'),
					});
				}
			}
			if (callbackFailed) {
				try {
					await this.call('exec', 'ROLLBACK');
				} catch (rollbackError) {
					const failure = new SqliteFailure('rollback_failed', null, {
						cause: new AggregateError(
							[callbackError, rollbackError],
							'Transaction and rollback both failed',
						),
					});
					this.poison(failure);
					throw failure;
				}
				throw callbackError;
			}
			try {
				await this.call('exec', 'COMMIT');
			} catch (error) {
				const failure = new SqliteFailure('commit_unknown', null, { cause: error });
				this.poison(failure);
				throw failure;
			}
			return result!;
		});
	}

	close(): Promise<void> {
		if (this.transactionScope.getStore()) {
			return Promise.reject(
				new SqliteFailure('transaction', null, {
					cause: new Error('Cannot close from an active transaction'),
				}),
			);
		}
		if (this.closePromise) return this.closePromise;
		this.closePromise = (async () => {
			let failure: unknown = null;
			try {
				await this.tail;
				if (this.unavailable) throw this.unavailable;
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
				paths.delete(this.path);
			}
			if (failure !== null) throw failure;
		})();
		return this.closePromise;
	}
}
