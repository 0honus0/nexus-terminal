import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { initializeAgentScopeSchema } from './scope/adapters/sqlite/scope-schema.js';
import {
	initializeAgentRunSchema,
	migrateAgentRunSteps,
	migrateAgentRunLifecycle,
} from './runs/adapters/sqlite/run-schema.js';
import { migrateAgentProviders } from './providers/adapters/sqlite/provider-schema.js';
import { migrateAgentGovernance as addGovernanceSchema } from './governance/adapters/sqlite/governance-schema.js';
import { migrateModelRegistry } from './providers/registry/adapters/sqlite/registry-sql.js';

/** v3: install scope before Runs; the application migration owns the transaction. */
export async function initializeAgentSchema(tx: SqlExecutor): Promise<void> {
	await initializeAgentScopeSchema(tx);
	await initializeAgentRunSchema(tx);
}

/** v7 only: existing v1–v6 signatures and schema are not rewritten. */
export async function migrateAgentProviderSchema(tx: SqlExecutor): Promise<void> {
	await migrateAgentProviders(tx);
	await migrateModelRegistry(tx);
}

/** v8: only additive Run-owned journal tables; existing migration signatures remain unchanged. */
export async function migrateAgentExecutionJournal(tx: SqlExecutor): Promise<void> {
	await migrateAgentRunSteps(tx);
}

/** v9 changes the referenced Run parent in-place through a dedicated FK-safe migration transaction. */
export async function migrateAgentRootRunLifecycle(tx: SqlExecutor): Promise<void> {
	await migrateAgentRunLifecycle(tx);
}

/** v10 additive governance records; historical migration signatures are immutable. */
export async function migrateAgentGovernance(tx: SqlExecutor): Promise<void> {
	await addGovernanceSchema(tx);
}
