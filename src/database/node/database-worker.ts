import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { workerData } from 'node:worker_threads';
import type { IGenericSqlite } from 'kysely-generic-sqlite';
import { createNodeOnMessageCallback } from 'kysely-generic-sqlite/worker-helper-node';
import { authorizePluginDatabase } from './database-authorization.js';

export type DatabaseWorkerOptions = { filename: string; tablePrefix?: string };

class SqliteExecutor implements IGenericSqlite<DatabaseSync> {
	readonly db: DatabaseSync;

	static listen(options: DatabaseWorkerOptions): void {
		let executor: SqliteExecutor | undefined;
		createNodeOnMessageCallback(() => (executor ??= new SqliteExecutor(options)));
	}

	constructor({ filename, tablePrefix }: DatabaseWorkerOptions) {
		const db = new DatabaseSync(filename, { timeout: 5_000 });
		try {
			if (tablePrefix) authorizePluginDatabase(db, tablePrefix);
			else db.exec('PRAGMA journal_mode = WAL');
		} catch (cause) {
			db.close();
			throw cause;
		}
		this.db = db;
	}

	query(_isSelect: boolean, sql: string, parameters?: readonly unknown[]) {
		using statement = this.#prepare(sql);
		const args = (parameters ?? []) as readonly SQLInputValue[];
		if (statement.columns().length > 0) return { rows: statement.all(...args) };
		statement.setReadBigInts(true);
		const { changes, lastInsertRowid } = statement.run(...args);
		return { rows: [], numAffectedRows: BigInt(changes), insertId: BigInt(lastInsertRowid) };
	}

	*iterator(_isSelect: boolean, sql: string, parameters?: readonly unknown[]) {
		using statement = this.#prepare(sql);
		yield* statement.iterate(...((parameters ?? []) as readonly SQLInputValue[]));
	}

	close(): void {
		this.db.close();
	}

	#prepare(sql: string): StatementSync & Disposable {
		// Node 26.13.1 implements Symbol.dispose; @types/node still omits it on StatementSync.
		return this.db.prepare(sql) as StatementSync & Disposable;
	}
}

// 连接身份由宿主创建 Worker 时固定，请求参数只传 SQL 和绑定值。
SqliteExecutor.listen(workerData as DatabaseWorkerOptions);
