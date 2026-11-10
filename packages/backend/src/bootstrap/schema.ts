import { retireMutationOrigin } from '../modules/remote/migrations.js';
import { removeRetiredEvents } from '../modules/operations/migrations.js';
import { removeRetiredAgent } from '../platform/storage/sqlite/adapters/migrations/remove-retired-agent.js';
import { initializeOperationsSchema, migrateOperationsPendingNotifications } from '../modules/operations/migrations.js';
import { initializePreferencesSchema } from '../modules/preferences/migrations.js';
import { initializeRemoteSchema } from '../modules/remote/migrations.js';
import type { SchemaMigration } from '../platform/storage/sqlite/schema-types.js';
import { initializeTargetsSchema } from '../modules/targets/migrations.js';
import { initializeAccessSchema, migrateAccessOidc, removeOidcVisibilitySwitch } from '../modules/access/migrations.js';
import {
	initializeAgentSchema,
	migrateAgentToolBatches,
	migrateAgentToolOutputs,
	agentPerformanceMigrations,
	agentModularMigrations,
} from '../platform/storage/sqlite/adapters/migrations/agent-history/backend/migrations.js';
import { initializeSnapshotRestoreSchema } from '../platform/storage/sqlite/adapters/snapshot-restore-sql.js';

/** Append-only published migration chain; retired feature SQL remains private to historical upgrades. */
export const applicationMigrations: readonly SchemaMigration[] = [
	{
		version: 1,
		signature: 'backend-next-v1-initial-20261105-rdp-certificates',

		async apply(tx) {
			await initializeTargetsSchema(tx);
			await initializeAccessSchema(tx);
			await initializeAgentSchema(tx);
			await initializeRemoteSchema(tx);
			await initializePreferencesSchema(tx);
			await initializeOperationsSchema(tx);
			await initializeSnapshotRestoreSchema(tx);
		},
	},
	{
		version: 2,
		signature: 'agent-shell-command-batches-20261105',
		apply: migrateAgentToolBatches,
	},
	{ version: 3, signature: 'agent-artifact-output-batches-20261105', apply: migrateAgentToolOutputs },
	{ version: 4, signature: 'access-oidc-20261106', apply: migrateAccessOidc },
	...agentPerformanceMigrations,
	{
		version: 10,
		signature: 'operations-notification-pending-20261106',
		apply: migrateOperationsPendingNotifications,
	},
	...agentModularMigrations,
	{ version: 66, signature: 'access-oidc-binding-visibility-20261109', apply: removeOidcVisibilitySwitch },
	{ version: 67, signature: 'remove-retired-agent-20261110', apply: removeRetiredAgent },
	{ version: 68, signature: 'remote-retired-producer-origin-20261110', apply: retireMutationOrigin },
	{ version: 69, signature: 'operations-remove-retired-agent-events-20261110', apply: removeRetiredEvents },
];
