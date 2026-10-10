import type { SqlExecutor } from '../../../../platform/storage/sqlite/sql-types.js';
import type { ConnectionData, StoredConnection } from '../../connections/storage/connection-storage.js';
import type { ProxyTransactionStorage } from '../../proxies/storage/proxy-storage.js';
import type { TagTransactionStorage } from '../../tags/storage/tag-storage.js';

/**
 * Internal, explicit transaction-scoped participants.
 * Bootstrap/module registration owns the concrete wiring; import SQL never
 * reaches into another subfeature's private SQLite implementation.
 */
export interface ImportTransactionParticipants {
	connections: {
		insert(tx: SqlExecutor, data: ConnectionData): Promise<StoredConnection>;
	};
	proxies: ProxyTransactionStorage;
	tags: TagTransactionStorage;
}
