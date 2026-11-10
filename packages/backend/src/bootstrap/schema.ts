import { initializeOperationsSchema } from '../modules/operations/migrations.js';
import { initializePreferencesSchema } from '../modules/preferences/migrations.js';
import { initializeRemoteSchema } from '../modules/remote/migrations.js';
import type { SchemaMigration } from '../platform/storage/sqlite/schema-types.js';
import { initializeTargetsSchema } from '../modules/targets/migrations.js';
import { initializeAccessSchema } from '../modules/access/migrations.js';
import { initializeSnapshotRestoreSchema } from '../platform/storage/sqlite/adapters/snapshot-restore-sql.js';

/** Development baseline: create the final schema directly and keep its version at one. */
export const applicationMigrations: readonly SchemaMigration[] = [
	{
		version: 1,
		signature: 'nexus-terminal-v1-development-20261110',

		async apply(tx) {
			await initializeTargetsSchema(tx);
			await initializeAccessSchema(tx);
			await initializeRemoteSchema(tx);
			await initializePreferencesSchema(tx);
			await initializeOperationsSchema(tx);
			await initializeSnapshotRestoreSchema(tx);
		},
	},
];
