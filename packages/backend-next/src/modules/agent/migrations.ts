import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { initializeAgentScopeSchema } from './scope/adapters/sqlite/scope-schema.js';
import { initializeAgentRunSchema } from './runs/adapters/sqlite/run-schema.js';

/** v3: install scope before Runs; the application migration owns the transaction. */
export async function initializeAgentSchema(tx: SqlExecutor): Promise<void> {
	await initializeAgentScopeSchema(tx);
	await initializeAgentRunSchema(tx);
}
