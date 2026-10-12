import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { initializeAccountSchema } from './accounts/adapters/sqlite/account-schema.js';
import { initializeSessionSchema, extendSessionLoginFailureSchema } from './sessions/adapters/sqlite/session-schema.js';
import { extendAccessFactors } from './factors/adapters/sqlite/factor-schema.js';

/** One unreleased v1 layout; independently versioned Access migrations are not permitted. */
export async function initializeAccessSchema(tx: SqlExecutor): Promise<void> {
	await initializeAccountSchema(tx);
	await initializeSessionSchema(tx);
}

/** Installed only through the application-wide migration registry. */
export async function migrateAccessLoginFailureHistory(tx: SqlExecutor): Promise<void> {
	await extendSessionLoginFailureSchema(tx);
}

export async function migrateAccessFactors(tx: SqlExecutor): Promise<void> {
	await extendAccessFactors(tx);
}
