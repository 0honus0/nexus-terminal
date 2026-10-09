import type { SchemaMigration } from '../platform/storage/sqlite/schema.js';
import { targetMigrations } from '../modules/targets/schema.js';
import { initializeAccessSchema } from '../modules/access/migrations.js';
import { initializeHostKeySchema } from '../modules/targets/host-keys/schema.js';

/** Application owns the only ordered migration registry; modules own DDL. */
export const applicationMigrations: readonly SchemaMigration[] = [
	{
		version: 1,
		signature: 'backend-next-v1-targets-access-20261009',

		async apply(tx) {
			await targetMigrations[0].apply(tx);
			await initializeAccessSchema(tx);
		},
	},
	{
		version: 2,
		signature: 'backend-next-v2-target-host-key-trust-20261010',

		async apply(tx) {
			await initializeHostKeySchema(tx);
		},
	},
];
