import type { ConnectionMetadata } from '../../connections/model/connection-types.js';
import type { ProxyMetadata } from '../../proxies/model/proxy-types.js';

/** One metadata-only import item. Credentials and upload formats are out of scope. */
export interface ConnectionImport {
	connection: ConnectionMetadata;
	inlineProxy?: ProxyMetadata;
	tagNames?: string[];
}
