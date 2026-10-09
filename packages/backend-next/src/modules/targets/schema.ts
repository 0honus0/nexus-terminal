import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import { initializeProxiesSchema } from './proxies/adapters/sqlite/proxy-schema.js';
import { initializeTagsSchema } from './tags/adapters/sqlite/tag-schema.js';
import { initializeConnectionsSchema } from './connections/adapters/sqlite/connection-schema.js';

/** Assemble the Targets-owned tables in foreign-key dependency order. */
export async function initializeTargetsSchema(db: SqliteRuntime): Promise<void> {
	await initializeProxiesSchema(db);
	await initializeTagsSchema(db);
	await initializeConnectionsSchema(db);
}
