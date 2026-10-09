import type { SqlExecutor } from '../../../../platform/storage/sqlite/sqlite-runtime.js';

/** Internal import-transaction participant; not a standalone tag-management API. */
export interface TagTransactionStorage {
	findOrCreate(tx: SqlExecutor, name: string): Promise<number>;
}
