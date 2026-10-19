import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { initializeMachineMutations } from './machines/adapters/sqlite/mutation-schema.js';

export async function initializeRemoteSchema(tx: SqlExecutor): Promise<void> {
	await initializeMachineMutations(tx);
}
