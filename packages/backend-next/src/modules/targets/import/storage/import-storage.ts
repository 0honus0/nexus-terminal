import type { ConnectionData, StoredConnection } from '../../connections/storage/connection-storage.js';
import type { ProxyData } from '../../proxies/storage/proxy-storage.js';

export interface ImportConnectionCommand {
	connection: ConnectionData;
	inlineProxy?: ProxyData;
	tagNames?: string[];
}

export interface ConnectionImportStorage {
	importOne(command: ImportConnectionCommand): Promise<StoredConnection>;
}
