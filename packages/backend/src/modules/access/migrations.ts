import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { initializeAccountSchema } from './accounts/adapters/sqlite/account-schema.js';
import { initializeSessionSchema } from './sessions/adapters/sqlite/session-schema.js';
import { initializeAccessFactors } from './factors/adapters/sqlite/factor-schema.js';

export async function initializeAccessSchema(tx: SqlExecutor): Promise<void> {
	await initializeAccountSchema(tx);
	await initializeSessionSchema(tx);
	await initializeAccessFactors(tx);
}
