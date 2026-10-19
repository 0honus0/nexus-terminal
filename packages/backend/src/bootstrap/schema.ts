import { initializeOperationsSchema } from '../modules/operations/migrations.js';
import { initializePreferencesSchema } from '../modules/preferences/migrations.js';
import { initializeRemoteSchema } from '../modules/remote/migrations.js';
import type { SchemaMigration } from '../platform/storage/sqlite/schema-types.js';
import { targetMigrations, initializeHostKeySchema } from '../modules/targets/schema.js';
import { initializeAccessSchema } from '../modules/access/migrations.js';
import { initializeAgentSchema } from '../modules/agent/migrations.js';
import { initializeSnapshotRestoreSchema } from '../platform/storage/sqlite/adapters/snapshot-restore-sql.js';

/** First-release schema: install the current layout atomically, without development upgrade history. */
export const applicationMigrations: readonly SchemaMigration[] = [
	{
		version: 1,
		signature: 'backend-next-v1-initial-20261015-b9-mutation-evidence',

		async apply(tx) {
			await targetMigrations[0].apply(tx);
			await initializeHostKeySchema(tx);
			await initializeAccessSchema(tx);
			await initializeAgentSchema(tx);
			await initializeRemoteSchema(tx);
			await initializePreferencesSchema(tx);
			await initializeOperationsSchema(tx);
			await initializeSnapshotRestoreSchema(tx);
		},
	},
];
