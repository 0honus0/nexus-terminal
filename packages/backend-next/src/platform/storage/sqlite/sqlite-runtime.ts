import { Worker } from 'node:worker_threads';
import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
type Param = string | number | null;
type Row = Record<string, unknown>;
type Run = { changes: number; lastId: number };
export interface SqlExecutor {
	all(sql: string, params?: Param[]): Promise<Row[]>;
	one(sql: string, params?: Param[]): Promise<Row | null>;
	run(sql: string, params?: Param[]): Promise<Run>;
}
const paths = new Set<string>();
export class SqliteRuntime implements SqlExecutor {
	private worker: Worker;
	private pending = new Map<number, { resolve: (v: any) => void; reject: (error: Error) => void }>();
	private nextId = 0;
	private tail: Promise<unknown> = Promise.resolve();
	private closing = false;
	private closed = false;
	private failure: Error | null = null;
	private readonly transactionScope = new AsyncLocalStorage<boolean>();
	private constructor(readonly path: string) {
		this.worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: { path } });
		this.worker.on('message', (msg: { id: number; value?: any; error?: string }) => {
			const item = this.pending.get(msg.id);
			if (!item) return;
			this.pending.delete(msg.id);
			if (msg.error) item.reject(new Error(msg.error));
			else item.resolve(msg.value);
		});
		const failure = (error: Error) => {
			if (this.closed || this.failure) return;
			this.failure = error;
			for (const p of this.pending.values()) p.reject(error);
			this.pending.clear();
		};
		this.worker.on('error', failure);
		this.worker.on('exit', (code) => failure(new Error('SQLite worker exited: ' + code)));
	}
	static open(path: string): SqliteRuntime {
		if (path === ':memory:') throw new Error('Use a dedicated on-disk test database');
		const absolute = resolve(path);
		mkdirSync(dirname(absolute), { recursive: true });
		const canonical = resolve(realpathSync(dirname(absolute)), absolute.slice(dirname(absolute).length + 1));
		if (paths.has(canonical)) throw new Error('Database path already open');
		paths.add(canonical);
		try {
			return new SqliteRuntime(canonical);
		} catch (e) {
			paths.delete(canonical);
			throw e;
		}
	}
	private call<T>(kind: string, sql?: string, params?: Param[]): Promise<T> {
		return new Promise((resolve, reject) => {
			if (this.failure) {
				reject(this.failure);
				return;
			}
			if (this.closed) {
				reject(new Error('SQLite closed'));
				return;
			}
			const id = ++this.nextId;
			this.pending.set(id, { resolve, reject });
			try {
				this.worker.postMessage({ id, kind, sql, params });
			} catch (error) {
				this.pending.delete(id);
				reject(error);
			}
		});
	}
	private enqueue<T>(work: () => Promise<T>): Promise<T> {
		if (this.transactionScope.getStore())
			return Promise.reject(new Error('Use the transaction-scoped SQL executor inside a transaction'));
		if (this.closing) return Promise.reject(new Error('SQLite is closing'));
		if (this.failure) return Promise.reject(this.failure);
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
			const withinTransaction = <T>(kind: string, sql: string, params: Param[]): Promise<T> =>
				active
					? this.call(kind, sql, params)
					: Promise.reject(new Error('Transaction executor is no longer active'));
			const tx: SqlExecutor = {
				all: (sql, params = []) => withinTransaction('all', sql, params),
				one: (sql, params = []) => withinTransaction('one', sql, params),
				run: (sql, params = []) => withinTransaction('run', sql, params),
			};
			try {
				const result = await this.transactionScope.run(true, () => work(tx));
				active = false;
				await this.call('exec', 'COMMIT');
				return result;
			} catch (error) {
				active = false;
				try {
					await this.call('exec', 'ROLLBACK');
				} catch {}
				throw error;
			}
		});
	}
	async close(): Promise<void> {
		if (this.closing) return this.tail.then(() => undefined);
		this.closing = true;
		const drain = this.tail.then(async () => {
			try {
				if (!this.failure) await this.call('close');
			} finally {
				this.closed = true;
			}
		});
		this.tail = drain.catch(() => undefined);
		try {
			await drain;
		} finally {
			paths.delete(this.path);
			await this.worker.terminate();
		}
	}
}
