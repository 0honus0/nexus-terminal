import type { SqlExecutor } from '../../platform/storage/sqlite/sqlite-runtime.js';
import { initializeAccountSchema } from './accounts/adapters/sqlite/account-schema.js';
import { initializeSessionSchema } from './sessions/adapters/sqlite/session-schema.js';

/** One unreleased v1 layout; independently versioned Access migrations are not permitted. */
export async function initializeAccessSchema(tx: SqlExecutor): Promise<void> {
	await initializeAccountSchema(tx);
	await initializeSessionSchema(tx);
}
