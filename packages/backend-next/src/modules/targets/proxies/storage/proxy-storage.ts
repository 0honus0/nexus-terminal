import type { ProxyType } from '@nexus-terminal/shared/proxies/values';
import type { SqlExecutor } from '../../../../platform/storage/sqlite/sqlite-runtime.js';

export interface ProxyData {
	name: string;
	type: ProxyType;
	host: string;
	port: number;
	username: string | null;
}

/** Explicit transaction-scoped storage operation used by import. */
export interface ProxyTransactionStorage {
	findOrCreate(tx: SqlExecutor, data: ProxyData): Promise<number>;
}
