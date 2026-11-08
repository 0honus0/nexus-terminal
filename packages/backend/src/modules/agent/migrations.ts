import { initializeOperationDiagnostics } from './operations/adapters/sqlite/operation-diagnostic-schema.js';
import { removeArchivedRunData } from './runs/adapters/sqlite/run-archive-removal-migration.js';
import { removeArchivedPluginData } from './plugins/adapters/sqlite/plugin-archive-removal-migration.js';
import { initializeArtifactBlobRemovals } from './artifacts/adapters/sqlite/artifact-removal-schema.js';
import { initializePluginConnections } from './plugins/adapters/sqlite/plugin-connection-schema.js';
import { removeHostCompactionPreference } from './execution/adapters/sqlite/execution-plugin-settings-migration.js';
import { retireSdk3PluginPackages } from './plugins/adapters/sqlite/plugin-sdk4-migration.js';
import { describeOperationApprovals } from './governance/adapters/sqlite/operation-approval-schema.js';
import { bindPluginRuntimeInstances } from './plugins/adapters/sqlite/plugin-logical-runtime-migration.js';
import { initializePluginInstances } from './plugins/adapters/sqlite/plugin-instance-schema.js';
import { retirePreviousPluginSdk } from './plugins/adapters/sqlite/plugin-sdk3-migration.js';
import { migrateToolOutputBatches } from './runs/adapters/sqlite/run-tool-output-migration.js';
import { initializeThreadTitles } from './scope/adapters/sqlite/title-schema.js';
import { initializeAutomaticCompactions } from './context/adapters/sqlite/compaction-schema.js';
import { initializePluginIntents } from './plugins/adapters/sqlite/plugin-intent-sql.js';
import { initializeAgentPlugins } from './plugins/adapters/sqlite/plugin-schema.js';
import { initializeBrowserConfiguration } from './integrations/adapters/sqlite/browser-sql.js';
import { initializeAgentIntegrations } from './integrations/adapters/sqlite/integration-schema.js';
import { initializeIntegrationCreationRejections } from './integrations/adapters/sqlite/integration-rejection-migration.js';
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
import { indexExecutionBudgetRoot } from './execution/adapters/sqlite/execution-index-migration.js';
import { removeUnusedContextProfile } from './execution/adapters/sqlite/execution-context-profile-migration.js';
import {
	indexApprovalRun,
	indexApprovalTool,
	indexApprovalResolution,
} from './governance/adapters/sqlite/governance-index-migrations.js';
import { indexCompactionRun } from './context/adapters/sqlite/compaction-index-migration.js';
import { generalizeToolChildren } from './runs/adapters/sqlite/run-tool-children-migration.js';
import {
	scopePluginVersionsToUsers,
	initializePluginPackageInstallations,
	separatePluginAppInstallations,
	initializePluginAppBindings,
	initializePluginAppPackageReferences,
	archiveLegacyPluginPackages,
	fenceLegacyPluginPackages,
	scopePluginRuntimeInstances,
	scopePluginRuntimeHistory,
	initializePluginExtensionData,
	initializePluginExtensionOperations,
	initializePluginPackageUpdates,
	fenceMigratedPluginPackageUpdates,
} from './plugins/adapters/sqlite/plugin-package-migrations.js';
import { bindScopeExecutionDeclarations } from './scope/adapters/sqlite/definition-composition-migration.js';
import { retirePreviousPluginToolContract } from './plugins/adapters/sqlite/plugin-tool-contract-migration.js';
import { persistToolRequiredCapabilities } from './runs/adapters/sqlite/run-tool-capabilities-migration.js';
import { persistToolOutputArtifacts } from './runs/adapters/sqlite/run-tool-artifacts-migration.js';
import { persistToolIdentities } from './runs/adapters/sqlite/run-tool-identity-migration.js';
import { persistRunAppExecution } from './runs/adapters/sqlite/run-app-execution-migration.js';
import { initializePluginCompositionRoots } from './plugins/adapters/sqlite/plugin-composition-roots-migration.js';
import { initializeRunInputs } from './runs/adapters/sqlite/run-input-migration.js';
import { initializeOperations } from './operations/adapters/sqlite/operation-schema.js';
import { initializeOperationContents } from './operations/adapters/sqlite/operation-content-sql.js';
import { initializeRunAppState } from './runs/adapters/sqlite/run-app-state-schema.js';
import { initializeOperationAuthorities } from './operations/adapters/sqlite/operation-authority-schema.js';
import { bindToolJobsToOperations } from './tools/adapters/sqlite/tool-job-operation-migration.js';
import { bindProjectEffectsToOperations } from './tools/adapters/sqlite/tool-project-operation-migration.js';

export const agentPerformanceMigrations = [
	{ version: 5, signature: 'agent-budget-root-index-20261106', apply: indexExecutionBudgetRoot },
	{ version: 6, signature: 'agent-approval-run-index-20261106', apply: indexApprovalRun },
	{ version: 7, signature: 'agent-approval-tool-index-20261106', apply: indexApprovalTool },
	{ version: 8, signature: 'agent-resolution-approval-index-20261106', apply: indexApprovalResolution },
	{ version: 9, signature: 'agent-compaction-run-index-20261106', apply: indexCompactionRun },
];

export const agentModularMigrations = [
	{ version: 11, signature: 'agent-tool-children-20261106', apply: generalizeToolChildren },
	{ version: 12, signature: 'agent-plugin-user-versions-20261106', apply: scopePluginVersionsToUsers },
	{ version: 13, signature: 'agent-plugin-packages-20261106', apply: initializePluginPackageInstallations },
	{ version: 14, signature: 'agent-plugin-app-instances-20261106', apply: separatePluginAppInstallations },
	{ version: 15, signature: 'agent-plugin-app-bindings-20261106', apply: initializePluginAppBindings },
	{ version: 16, signature: 'agent-plugin-app-packages-20261106', apply: initializePluginAppPackageReferences },
	{ version: 17, signature: 'agent-plugin-legacy-archive-20261106', apply: archiveLegacyPluginPackages },
	{ version: 18, signature: 'agent-plugin-legacy-fence-20261106', apply: fenceLegacyPluginPackages },
	{ version: 19, signature: 'agent-plugin-runtime-scope-20261106', apply: scopePluginRuntimeInstances },
	{ version: 20, signature: 'agent-plugin-runtime-history-scope-20261106', apply: scopePluginRuntimeHistory },
	{ version: 21, signature: 'agent-plugin-extension-data-20261106', apply: initializePluginExtensionData },
	{
		version: 22,
		signature: 'agent-plugin-extension-operations-20261106',
		apply: initializePluginExtensionOperations,
	},
	{ version: 23, signature: 'agent-plugin-package-updates-20261106', apply: initializePluginPackageUpdates },
	{ version: 24, signature: 'agent-execution-declarations-20261106', apply: bindScopeExecutionDeclarations },
	{ version: 25, signature: 'agent-plugin-migrated-update-fence-20261106', apply: fenceMigratedPluginPackageUpdates },
	{ version: 26, signature: 'agent-tool-required-capabilities-20261106', apply: persistToolRequiredCapabilities },
	{ version: 27, signature: 'agent-tool-confirmed-output-artifacts-20261106', apply: persistToolOutputArtifacts },
	{ version: 28, signature: 'agent-tool-persisted-identity-20261106', apply: persistToolIdentities },
	{
		version: 29,
		signature: 'agent-plugin-host-operations-contract-20261106',
		apply: retirePreviousPluginToolContract,
	},
	{ version: 30, signature: 'agent-run-app-execution-binding-20261106', apply: persistRunAppExecution },
	{ version: 31, signature: 'agent-plugin-sdk3-contract-20261106', apply: retirePreviousPluginSdk },
	{ version: 32, signature: 'agent-remove-unused-context-profile-20261106', apply: removeUnusedContextProfile },
	{
		version: 33,
		signature: 'agent-integration-creation-rejections-20261106',
		apply: initializeIntegrationCreationRejections,
	},
	{ version: 34, signature: 'agent-plugin-explicit-roots-20261107', apply: initializePluginCompositionRoots },
	{ version: 35, signature: 'agent-generic-run-inputs-20261107', apply: initializeRunInputs },
	{ version: 36, signature: 'agent-generic-operations-20261107', apply: initializeOperations },
	{ version: 37, signature: 'agent-operation-content-references-20261107', apply: initializeOperationContents },
	{ version: 38, signature: 'agent-app-checkpoints-presentation-20261107', apply: initializeRunAppState },
	{
		version: 39,
		signature: 'agent-plugin-logical-instances-configuration-20261107',
		apply: initializePluginInstances,
	},
	{ version: 40, signature: 'agent-runtime-logical-scope-20261107', apply: bindPluginRuntimeInstances },
	{ version: 41, signature: 'agent-operation-approval-descriptions-20261107', apply: describeOperationApprovals },
	{ version: 42, signature: 'agent-operation-dispatch-authorities-20261107', apply: initializeOperationAuthorities },
	{ version: 43, signature: 'agent-operation-owned-shell-jobs-20261107', apply: bindToolJobsToOperations },
	{ version: 44, signature: 'agent-operation-owned-project-effects-20261107', apply: bindProjectEffectsToOperations },
	{ version: 45, signature: 'agent-operation-confirmed-artifacts-20261107', apply: initializeOperationArtifacts },
	{ version: 46, signature: 'agent-operation-owned-collaboration-20261107', apply: bindCollaborationToOperations },
	{ version: 47, signature: 'agent-operation-approval-sequence-20261107', apply: sequenceOperationApprovals },
	{
		version: 48,
		signature: 'agent-operation-approval-command-receipts-20261107',
		apply: initializeOperationApprovalCommands,
	},
	{ version: 49, signature: 'agent-operation-sequence-20261107', apply: sequenceOperations },
	{ version: 50, signature: 'agent-app-message-operation-lineage-20261107', apply: migrateRunMessageLineage },
	{ version: 51, signature: 'agent-plugin-fixed-connections-20261107', apply: initializePluginConnections },
	{ version: 52, signature: 'agent-run-suspension-status-20261107', apply: allowRunSuspension },
	{ version: 53, signature: 'agent-run-suspension-checkpoints-20261107', apply: initializeRunSuspensions },
	{ version: 54, signature: 'agent-run-resume-command-receipts-20261107', apply: initializeRunResumeCommands },
	{ version: 55, signature: 'agent-plugin-sdk4-contract-20261107', apply: retireSdk3PluginPackages },
	{ version: 56, signature: 'agent-plugin-private-instance-data-20261107', apply: initializePluginPrivateData },
	{
		version: 57,
		signature: 'agent-plugin-cleared-configuration-receipts-20261107',
		apply: fenceClearedPluginConfigurationReceipts,
	},
	{ version: 58, signature: 'agent-independent-ui-execution-references-20261107', apply: separatePluginUiExecution },
	{
		version: 59,
		signature: 'agent-remove-host-compaction-preference-20261107',
		apply: removeHostCompactionPreference,
	},
	{
		version: 60,
		signature: 'agent-operation-safe-failure-diagnostics-20261107',
		apply: initializeOperationDiagnostics,
	},
	{ version: 61, signature: 'agent-artifact-blob-removals-20261108', apply: initializeArtifactBlobRemovals },
	{ version: 62, signature: 'agent-remove-archived-execution-20261108', apply: removeArchivedRunData },
	{ version: 63, signature: 'agent-remove-archived-plugin-data-20261108', apply: removeArchivedPluginData },
];

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

import { initializeOperationArtifacts } from './operations/adapters/sqlite/operation-artifact-schema.js';
import { bindCollaborationToOperations } from './runs/adapters/sqlite/run-collaboration-operation-migration.js';
import {
	sequenceOperationApprovals,
	initializeOperationApprovalCommands,
} from './governance/adapters/sqlite/operation-approval-schema.js';

import { sequenceOperations } from './operations/adapters/sqlite/operation-sequence-schema.js';

import { migrateRunMessageLineage } from './runs/adapters/sqlite/run-message-lineage-migration.js';
import {
	allowRunSuspension,
	initializeRunSuspensions,
	initializeRunResumeCommands,
} from './runs/adapters/sqlite/run-suspension-schema.js';
import { initializePluginPrivateData } from './plugins/adapters/sqlite/plugin-data-schema.js';

import { fenceClearedPluginConfigurationReceipts } from './plugins/adapters/sqlite/plugin-instance-schema.js';
import { separatePluginUiExecution } from './plugins/adapters/sqlite/plugin-ui-execution-migration.js';
