import { indexExecutionBudgetRoot } from './execution/adapters/sqlite/execution-index-migration.js';
import {
	indexApprovalRun,
	indexApprovalTool,
	indexApprovalResolution,
} from './governance/adapters/sqlite/governance-index-migrations.js';
import { indexCompactionRun } from './context/adapters/sqlite/compaction-index-migration.js';
import { migrateToolOutputBatches } from './runs/adapters/sqlite/run-tool-output-migration.js';
import { initializeThreadTitles } from './scope/adapters/sqlite/title-schema.js';
import { initializeAutomaticCompactions } from './context/adapters/sqlite/compaction-schema.js';
import { initializePluginIntents } from './plugins/adapters/sqlite/plugin-intent-sql.js';
import { initializeAgentPlugins } from './plugins/adapters/sqlite/plugin-schema.js';
import { initializeBrowserConfiguration } from './integrations/adapters/sqlite/browser-sql.js';
import { initializeAgentIntegrations } from './integrations/adapters/sqlite/integration-schema.js';
import { initializeAgentExecution } from './execution/adapters/sqlite/execution-schema.js';
import { initializeContextCheckpoints } from './context/adapters/sqlite/checkpoint-sql.js';
import { initializeAgentArtifacts } from './artifacts/adapters/sqlite/artifact-schema.js';
import { initializeAgentMemory } from './memory/adapters/sqlite/memory-schema.js';
import { initializeToolProjects } from './tools/adapters/sqlite/tool-project-schema.js';
import { initializeContextSnapshots } from './context/adapters/sqlite/context-schema.js';
import { initializeRunCollaboration } from './runs/adapters/sqlite/run-collaboration-schema.js';
import { initializeToolJobs } from './tools/adapters/sqlite/tool-job-schema.js';
import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { initializeAppDeclarations } from './scope/adapters/sqlite/app-schema.js';
import { initializeAgentScopeSchema } from './scope/adapters/sqlite/scope-schema.js';
import { initializeAgentRunSchema, initializeAgentRunSteps } from './runs/adapters/sqlite/run-schema.js';
import { initializeAgentProviders } from './providers/adapters/sqlite/provider-schema.js';
import { initializeModelRegistry } from './providers/registry/adapters/sqlite/registry-sql.js';
import { initializeAgentGovernance } from './governance/adapters/sqlite/governance-schema.js';
import { initializeTargetDenylist } from './governance/adapters/sqlite/denylist-schema.js';
import { initializeRunTools } from './runs/adapters/sqlite/run-tool-schema.js';
import { migrateToolJobBatchResults } from './tools/adapters/sqlite/tool-job-batch-migration.js';

export async function migrateAgentToolBatches(tx: SqlExecutor): Promise<void> {
	await migrateToolJobBatchResults(tx);
}

/** Module installation order; SQL remains in the owning adapters. */
export async function initializeAgentSchema(tx: SqlExecutor): Promise<void> {
	await initializeAppDeclarations(tx);
	await initializeAgentScopeSchema(tx);
	await initializeAgentRunSchema(tx);
	await initializeAgentProviders(tx);
	await initializeModelRegistry(tx);
	await initializeAgentRunSteps(tx);
	await initializeContextSnapshots(tx);
	await initializeAutomaticCompactions(tx);
	await initializeThreadTitles(tx);
	await initializeRunTools(tx);
	await initializeContextCheckpoints(tx);
	await initializeRunCollaboration(tx);
	await initializeToolJobs(tx);
	await initializeToolProjects(tx);
	await initializeAgentGovernance(tx);
	await initializeTargetDenylist(tx);
	await initializeAgentMemory(tx);
	await initializeAgentArtifacts(tx);
	await initializeAgentExecution(tx);
	await initializeAgentIntegrations(tx);
	await initializeBrowserConfiguration(tx);
	await initializeAgentPlugins(tx);
	await initializePluginIntents(tx);
}

export async function migrateAgentToolOutputs(tx: SqlExecutor): Promise<void> {
	await migrateToolOutputBatches(tx);
}

export const agentPerformanceMigrations = [
	{ version: 5, signature: 'agent-budget-root-index-20261106', apply: indexExecutionBudgetRoot },
	{ version: 6, signature: 'agent-approval-run-index-20261106', apply: indexApprovalRun },
	{ version: 7, signature: 'agent-approval-tool-index-20261106', apply: indexApprovalTool },
	{ version: 8, signature: 'agent-resolution-approval-index-20261106', apply: indexApprovalResolution },
	{ version: 9, signature: 'agent-compaction-run-index-20261106', apply: indexCompactionRun },
];
