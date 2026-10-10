import type { SchemaMigration } from '../platform/storage/sqlite/schema-types.js';
import { targetMigrations, initializeHostKeySchema } from '../modules/targets/schema.js';
import { initializeAccessSchema } from '../modules/access/migrations.js';
import { initializeAgentSchema } from '../modules/agent/migrations.js';

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
	{
		version: 3,
		signature: 'backend-next-v3-agent-root-run-20261010',

		async apply(tx) {
			await initializeAgentSchema(tx);
		},
	},
];
