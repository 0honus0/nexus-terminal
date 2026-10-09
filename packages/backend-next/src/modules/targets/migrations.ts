import type { SchemaMigration } from '../../platform/storage/sqlite/schema.js';
import { initializeConnectionsSchema } from './connections/adapters/sqlite/connection-schema.js';
import { initializeConnectionCredentialSchema } from './connections/adapters/sqlite/connection-credential-schema.js';
import { initializeProxiesSchema } from './proxies/adapters/sqlite/proxy-schema.js';
import { initializeTagsSchema } from './tags/adapters/sqlite/tag-schema.js';
import { initializeSshKeySchema } from './ssh-keys/adapters/sqlite/ssh-key-schema.js';

/**
 * Only v1 is installed: the old two-step v1→v2 was a pre-release migration
 * exercise, not a published upgrade. New schemas should not be constructed by
 * upgrading a first-batch development database.
 */
export const targetMigrations: readonly SchemaMigration[] = [
	{
		version: 1,
		signature: 'targets-v1-initial-20261009',

		async apply(tx) {
			await initializeProxiesSchema(tx);
			await initializeTagsSchema(tx);
			await initializeSshKeySchema(tx);
			await initializeConnectionsSchema(tx);
			await initializeConnectionCredentialSchema(tx);
		},
	},
];
