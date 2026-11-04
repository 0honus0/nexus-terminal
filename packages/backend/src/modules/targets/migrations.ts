import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { initializeConnectionsSchema } from './connections/adapters/sqlite/connection-schema.js';
import { initializeConnectionCredentialSchema } from './connections/adapters/sqlite/connection-credential-schema.js';
import { initializeProxiesSchema } from './proxies/adapters/sqlite/proxy-schema.js';
import { initializeTagsSchema } from './tags/adapters/sqlite/tag-schema.js';
import { initializeSshKeySchema } from './ssh-keys/adapters/sqlite/ssh-key-schema.js';
import { initializeHostKeySchema } from './host-keys/adapters/sqlite/host-key-schema.js';

export async function initializeTargetsSchema(tx: SqlExecutor): Promise<void> {
	await initializeProxiesSchema(tx);
	await initializeTagsSchema(tx);
	await initializeSshKeySchema(tx);
	await initializeConnectionsSchema(tx);
	await initializeConnectionCredentialSchema(tx);
	await initializeHostKeySchema(tx);
}
