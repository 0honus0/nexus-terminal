import type { SqlExecutor } from '../sql-types.js';

/** SQLite transaction dialect; Runtime owns sequencing and failure semantics. */
export class SqliteTransactionAdapter {
	constructor(private readonly executor: Pick<SqlExecutor, 'exec'>) {}

	begin(): Promise<void> {
		return this.executor.exec('BEGIN IMMEDIATE');
	}

	commit(): Promise<void> {
		return this.executor.exec('COMMIT');
	}

	rollback(): Promise<void> {
		return this.executor.exec('ROLLBACK');
	}
}
