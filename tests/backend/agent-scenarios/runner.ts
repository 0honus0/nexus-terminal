import { performance } from 'node:perf_hooks';

import { artifactSingleDeleteProductScenario } from './artifact-single-delete-product.scenario';
import { memoryProductClosureScenario } from './memory-product-closure.scenario';
import { pluginAppIntentSdkScenario } from './plugin-app-intent-sdk.scenario';
import { providerPromptCacheHintScenario } from './provider-prompt-cache-hint.scenario';

import { unifiedFileCapabilityScenario } from './unified-file-capability.scenario';
import { unifiedShellCapabilityScenario } from './unified-shell-capability.scenario';
import { subagentGovernedMutationScenario } from './subagent-governed-mutation.scenario';
import { restartRecoveryScenario } from './restart-recovery.scenario';
import { checkpointWorkspaceEvidenceScenario } from './checkpoint-workspace-evidence.scenario';
import { workspaceRepoMapCodeIntelScenario } from './workspace-repo-map-code-intel.scenario';
import { workspaceBackgroundJobLifecycleScenario } from './workspace-background-job-lifecycle.scenario';
import { agentDefinitionCapabilityContractScenario } from './agent-definition-capability-contract.scenario';
import { workspaceCodingToolSurfaceScenario } from './workspace-coding-tool-surface.scenario';
import { nestedJoinDurableWakeScenario } from './nested-join-durable-wake.scenario';
import { userInputClarificationScenario } from './user-input-clarification.scenario';
import { mcpInputRequiredDurableLifecycleScenario } from './mcp-input-required-durable-lifecycle.scenario';
import { acpInnerPermissionDurabilityScenario } from './acp-inner-permission-durability.scenario';
import { subagentClaimedCancellationScenario } from './subagent-claimed-cancellation.scenario';
import { completionGateScenario } from './completion-gate.scenario';
import { subagentMailboxTtlScenario } from './subagent-mailbox-ttl.scenario';
import { progressAwareLoopGuardScenario } from './progress-aware-loop-guard.scenario';
import { appDisableScopeScenario } from './app-disable-scope.scenario';
import { confirmedMutationLeaseFinalizationScenario } from './confirmed-mutation-lease-finalization.scenario';
import { mcpProtocolSurfaceScenario } from './mcp-protocol-surface.scenario';
import { integrationHealthRetryScenario } from './integration-health-retry.scenario';
import { idempotencyTtlScenario } from './idempotency-ttl.scenario';

import { browserInteractionPrimitivesScenario } from './browser-interaction-primitives.scenario';
import { suspendedSessionOwnershipScenario } from './suspended-session-ownership.scenario';
import { browserScreenshotVisionScenario } from './browser-screenshot-vision.scenario';
import { toolSurfaceProgressiveDisclosureScenario } from './tool-surface-progressive-disclosure.scenario';
import { machineRouteDependencyApprovalScenario } from './machine-route-dependency-approval.scenario';
import { contextTokenAccountingScenario } from './context-token-accounting.scenario';
import { providerContinuationRoundTripScenario } from './provider-continuation-roundtrip.scenario';
import { durableContextCheckpointScenario } from './durable-context-checkpoint.scenario';
import { subagentProfileStrategyScenario } from './subagent-profile-strategy.scenario';
import { skillProgressiveDisclosureScenario } from './skill-progressive-disclosure.scenario';
import { artifactModelInputScenario } from './artifact-model-input.scenario';
import { contextToolExchangeScenario } from './context-tool-exchange.scenario';
import { readToolBatchAuthorityScenario } from './read-tool-batch-authority.scenario';
import { capabilityGrantMigrationScenario } from './capability-grant-migration.scenario';
import { integrationRefreshGenerationScenario } from './integration-refresh-generation.scenario';
import { artifactCrashReconciliationScenario } from './artifact-crash-reconciliation.scenario';
import { artifactLifecycleSettingsScenario } from './artifact-lifecycle-settings.scenario';
import { indexedRecallScenario } from './indexed-recall.scenario';
import { integrationCasBeforeRuntimeScenario } from './integration-cas-before-runtime.scenario';
import { budgetSettingsDeadFieldScenario } from './budget-settings-dead-field.scenario';
import { modelFinishReasonStateMachineScenario } from './model-finish-reason-state-machine.scenario';
import { browserTargetScopedRevisionScenario } from './browser-target-scoped-revision.scenario';
import { cumulativeTokenCeilingRemovedScenario } from './cumulative-token-ceiling-removed.scenario';

import { modelAwareContextBudgetScenario } from './model-aware-context-budget.scenario';
import { acpInnerPermissionScenario } from './acp-inner-permission.scenario';
import { mutationOutputProjectionScenario } from './mutation-output-projection.scenario';
import { publicAgentErrorTaxonomyScenario } from './public-agent-error-taxonomy.scenario';
import { acpInnerPermissionReplayScenario } from './acp-inner-permission-replay.scenario';
import { acpInnerPermissionAbortRaceScenario } from './acp-inner-permission-abort-race.scenario';
import { failFastSiblingCancellationScenario } from './fail-fast-sibling-cancellation.scenario';
import { modelCapabilityRegistrySyncScenario } from './model-capability-registry-sync.scenario';
import { legacyMachineInspectionMigrationScenario } from './legacy-machine-inspection-migration.scenario';
import { durableBoundaryDecodeScenario } from './durable-boundary-decode.scenario';
import { currentDurableSchemaScenario } from './current-durable-schema.scenario';
import { providerSettingsDeadFieldScenario } from './provider-settings-dead-field.scenario';
import { defaultPolicyAuthorityScenario } from './default-policy-authority.scenario';
import { logErrorCodeSafetyScenario } from './log-error-code-safety.scenario';
import { projectInstructionsContextScenario } from './project-instructions-context.scenario';
import { toolResultProjectionScenario } from './tool-result-projection.scenario';
import { scriptedAgentBenchmarkScenario } from './scripted-agent-benchmark.scenario';
import { modelStreamRetryAttemptIdentityScenario } from './model-stream-retry-attempt-identity.scenario';
import { agentLifecycleNotificationScenario } from './agent-lifecycle-notification.scenario';
import { planExecutionModeScenario } from './plan-execution-mode.scenario';
import { providerFallbackChainScenario } from './provider-fallback-chain.scenario';
import { providerLiveCapabilityAuthorityScenario } from './provider-live-capability-authority.scenario';

interface ScenarioMetric {
  name: string;
  value: number;
  unit: string;
}

interface ScenarioResult {
  name: string;
  durationMs: number;
  metrics: ScenarioMetric[];
}

type Scenario = () => Promise<ScenarioMetric[]>;

const scenarios = new Map<string, Scenario>([
  ['context/tool-exchange-atomicity', contextToolExchangeScenario],
  ['context/durable-compaction-checkpoint', durableContextCheckpointScenario],
  ['migration/legacy-machine-inspection-targets', legacyMachineInspectionMigrationScenario],
  ['migration/capability-grants-v2', capabilityGrantMigrationScenario],
  ['context/token-accounting', contextTokenAccountingScenario],
  ['context/project-instructions', projectInstructionsContextScenario],
  ['workspace/coding-tool-surface', workspaceCodingToolSurfaceScenario],
  ['file/unified-targets', unifiedFileCapabilityScenario],
  ['shell/unified-targets', unifiedShellCapabilityScenario],
  ['workspace/repo-map-code-intel', workspaceRepoMapCodeIntelScenario],
  ['workspace/background-job-lifecycle', workspaceBackgroundJobLifecycleScenario],
  ['context/tool-result-projection', toolResultProjectionScenario],
  ['context/tool-surface-progressive-disclosure', toolSurfaceProgressiveDisclosureScenario],
  ['runtime/mcp-protocol-surface', mcpProtocolSurfaceScenario],
  ['runtime/mcp-input-required-durable-lifecycle', mcpInputRequiredDurableLifecycleScenario],
  ['provider/prompt-cache-hint', providerPromptCacheHintScenario],
  ['context/artifact-model-input', artifactModelInputScenario],
  ['context/skill-progressive-disclosure', skillProgressiveDisclosureScenario],
  ['context/indexed-recall', indexedRecallScenario],
  ['benchmark/scripted-agent-trajectories', scriptedAgentBenchmarkScenario],
  ['boundary/durable-runtime-decode', durableBoundaryDecodeScenario],
  ['boundary/current-durable-schema', currentDurableSchemaScenario],
  ['model/capability-registry-sync', modelCapabilityRegistrySyncScenario],
  ['model/provider-live-capability-authority', providerLiveCapabilityAuthorityScenario],
  ['model/stream-retry-attempt-identity', modelStreamRetryAttemptIdentityScenario],
  ['runtime/agent-lifecycle-notifications', agentLifecycleNotificationScenario],
  ['model/plan-execution-mode', planExecutionModeScenario],
  ['runtime/default-policy-authority', defaultPolicyAuthorityScenario],
  ['runtime/log-error-code-safety', logErrorCodeSafetyScenario],
  ['runtime/budget-settings-dead-fields', budgetSettingsDeadFieldScenario],
  ['model/provider-settings-dead-field', providerSettingsDeadFieldScenario],
  ['model/provider-fallback-chain', providerFallbackChainScenario],
  ['model/agent-definition-capability-contract', agentDefinitionCapabilityContractScenario],
  ['model/completion-gate', completionGateScenario],
  ['model/finish-reason-state-machine', modelFinishReasonStateMachineScenario],
  ['model/provider-continuation-roundtrip', providerContinuationRoundTripScenario],
  ['runtime/user-input-clarification', userInputClarificationScenario],
  ['runtime/restart-recovery-closure', restartRecoveryScenario],
  ['runtime/app-disable-scope-closure', appDisableScopeScenario],
  ['runtime/read-tool-batch-authority', readToolBatchAuthorityScenario],
  ['runtime/subagent-claimed-cancellation', subagentClaimedCancellationScenario],
  ['runtime/subagent-fail-fast-cancellation', failFastSiblingCancellationScenario],
  ['runtime/nested-join-durable-wake', nestedJoinDurableWakeScenario],
  ['runtime/subagent-mailbox-ttl', subagentMailboxTtlScenario],
  ['runtime/subagent-profile-strategy', subagentProfileStrategyScenario],
  ['runtime/subagent-governed-mutation', subagentGovernedMutationScenario],
  ['runtime/confirmed-mutation-lease-finalization', confirmedMutationLeaseFinalizationScenario],
  ['runtime/mutation-output-projection', mutationOutputProjectionScenario],
  ['storage/artifact-lifecycle-settings', artifactLifecycleSettingsScenario],
  ['recovery/checkpoint-workspace-evidence', checkpointWorkspaceEvidenceScenario],
  ['runtime/artifact-crash-reconciliation', artifactCrashReconciliationScenario],
  ['runtime/integration-cas-before-runtime', integrationCasBeforeRuntimeScenario],
  ['runtime/integration-refresh-generation', integrationRefreshGenerationScenario],
  ['runtime/integration-health-retry', integrationHealthRetryScenario],
  ['runtime/acp-inner-permission', acpInnerPermissionScenario],
  ['runtime/acp-inner-permission-abort-race', acpInnerPermissionAbortRaceScenario],
  ['runtime/acp-inner-permission-replay', acpInnerPermissionReplayScenario],
  ['runtime/acp-inner-permission-durable', acpInnerPermissionDurabilityScenario],
  ['runtime/idempotency-ttl', idempotencyTtlScenario],
  ['runtime/model-aware-context-budget', modelAwareContextBudgetScenario],
  ['runtime/cumulative-token-ceiling-removed', cumulativeTokenCeilingRemovedScenario],
  ['runtime/progress-aware-loop-guard', progressAwareLoopGuardScenario],
  ['http/public-agent-error-taxonomy', publicAgentErrorTaxonomyScenario],
  ['runtime/plugin-app-intent-sdk', pluginAppIntentSdkScenario],
  ['runtime/memory-product-closure', memoryProductClosureScenario],
  ['workspace/suspended-session-ownership', suspendedSessionOwnershipScenario],
  ['browser/target-scoped-revision', browserTargetScopedRevisionScenario],
  ['browser/interaction-primitives', browserInteractionPrimitivesScenario],
  ['browser/screenshot-artifact-vision', browserScreenshotVisionScenario],
  ['machine/route-dependency-approval', machineRouteDependencyApprovalScenario],
  ['runtime/artifact-single-delete-product', artifactSingleDeleteProductScenario],
]);

const SERIAL_SCENARIOS = new Set([
  'workspace/coding-tool-surface',
  'provider/prompt-cache-hint',
  'model/capability-registry-sync',
  'model/provider-live-capability-authority',
]);

const SCENARIO_CONCURRENCY = 4;

interface ScenarioOutcome {
  result: ScenarioResult | null;
  failure: { name: string; error: unknown } | null;
}

const executeScenario = async ([name, run]: [string, Scenario]): Promise<ScenarioOutcome> => {
  const started = performance.now();
  try {
    const metrics = await run();
    return {
      result: { name, durationMs: performance.now() - started, metrics },
      failure: null,
    };
  } catch (error) {
    return {
      result: null,
      failure: { name, error },
    };
  }
};

const main = async (): Promise<void> => {
  const results: ScenarioResult[] = [];
  const failures: Array<{ name: string; error: unknown }> = [];

  const recordOutcome = (outcome: ScenarioOutcome): void => {
    if (outcome.result) {
      results.push(outcome.result);
      console.log(`PASS ${outcome.result.name}`);
      return;
    }
    if (outcome.failure) {
      failures.push(outcome.failure);
      console.error(`FAIL ${outcome.failure.name}`);
    }
  };

  const runConcurrentBatch = async (entries: Array<[string, Scenario]>): Promise<void> => {
    for (let index = 0; index < entries.length; index += SCENARIO_CONCURRENCY) {
      const outcomes = await Promise.all(entries.slice(index, index + SCENARIO_CONCURRENCY).map(executeScenario));
      for (const outcome of outcomes) recordOutcome(outcome);
    }
  };

  let concurrentBatch: Array<[string, Scenario]> = [];
  for (const entry of scenarios.entries()) {
    if (!SERIAL_SCENARIOS.has(entry[0])) {
      concurrentBatch.push(entry);
      continue;
    }

    await runConcurrentBatch(concurrentBatch);
    concurrentBatch = [];
    recordOutcome(await executeScenario(entry));
  }
  await runConcurrentBatch(concurrentBatch);

  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        scenarios: results.map((result) => ({
          ...result,
          durationMs: Math.round(result.durationMs * 100) / 100,
        })),
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAILURE ${failure.name}`, failure.error);
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `${failures.length} Agent scenario(s) failed`,
    );
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
