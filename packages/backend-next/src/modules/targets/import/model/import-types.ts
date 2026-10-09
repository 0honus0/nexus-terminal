import type { ConnectionMetadata } from '../../connections/model/connection-types.js';
import type { ProxyData } from '../../proxies/storage/proxy-storage.js';

/** One metadata-only import item. Credentials and upload formats are out of scope. */
export interface ConnectionImport {
	connection: ConnectionMetadata;
	inlineProxy?: ProxyData;
	tagNames?: string[];
}
