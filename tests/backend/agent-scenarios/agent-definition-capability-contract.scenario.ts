import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decodePersistedAppManifest } from '../../../packages/backend/src/infrastructure/agent/plugins/persisted-app-manifest-decoder';
import {
  resolveProviderModelConfig,
  snapshotProviderModelCapabilities,
} from '../../../packages/backend/src/modules/agent/ai/model-capability-resolver';
import {
  missingRequiredModelCapabilities,
  normalizeRequiredModelCapabilities,
} from '../../../packages/backend/src/modules/agent/ai/model-capability-requirements';
import type { ProviderModelCapabilityObservation } from '../../../packages/backend/src/modules/agent/ai/model.types';
import { validateManifest } from '../../../packages/backend/src/modules/agent/host/app-manifest-validator';
import { RunService } from '../../../packages/backend/src/modules/agent/runtime/runs/run.service';
import type { AtomicCreateRun } from '../../../packages/backend/src/modules/agent/runtime/runs/state-commit.port';
import { CheckpointService } from '../../../packages/backend/src/modules/agent/runtime/recovery/checkpoint.service';
import type { CheckpointView } from '../../../packages/backend/src/modules/agent/runtime/recovery/checkpoint.repository.port';
import type { RunSnapshot, RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { clock, scope } from './scenario-fixtures';

export const agentDefinitionCapabilityContractScenario = async () => {
  const canonicalManifest = {
    schemaVersion: 1,
    id: 'scenario.capability-contract',
    version: '1.0.0',
    displayName: 'Capability contract',
    sdkVersion: '1.0.0',
    nexus: { minVersion: '1.0.0', maxVersion: '9.0.0' },
    capabilities: [],
    intents: [],
    agents: [
      {
        id: 'scenario.agent',
        version: '1.0.0',
        displayName: 'Scenario Agent',
        description: 'Exercises AgentDefinition model capability requirements.',
        requiredModelCapabilities: ['tools'],
      },
    ],
  };
  const validatedManifest = validateManifest(canonicalManifest, {
    nexusVersion: '1.0.0',
    supportedSdkMajor: 1,
  });
  assert.deepEqual(validatedManifest.agents?.[0]?.requiredModelCapabilities, ['tools']);
  assert.deepEqual(
    decodePersistedAppManifest(JSON.stringify(canonicalManifest)).agents?.[0]?.requiredModelCapabilities,
    ['tools'],
  );
  assert.throws(
    () =>
      validateManifest(
        {
          ...canonicalManifest,
          agents: [
            {
              ...canonicalManifest.agents[0],
              requiredModelCapabilities: ['provider_magic'],
            },
          ],
        },
        { nexusVersion: '1.0.0', supportedSdkMajor: 1 },
      ),
    /AGENT_MANIFEST_SCHEMA_INVALID|Unknown Agent model capability requirement/,
  );
  assert.equal(normalizeRequiredModelCapabilities(['provider_magic']), null);

  const privateModel = resolveProviderModelConfig({
    id: 'private-explicit-model',
    capabilityOverrides: {
      contextWindow: 16_384,
      maxOutputTokens: 2_048,
      supportsTools: true,
      supportsImageInput: true,
      supportsFileInput: false,
      reasoning: {
        supportedEfforts: ['none', 'medium'],
        defaultEffort: 'medium',
      },
    },
  });
  const privateSnapshot = snapshotProviderModelCapabilities(privateModel);
  assert.deepEqual(missingRequiredModelCapabilities(['tools', 'image_input', 'reasoning'], privateSnapshot), []);
  assert.deepEqual(missingRequiredModelCapabilities(['file_input'], privateSnapshot), ['file_input']);

  const unknownPrivateModel = resolveProviderModelConfig({
    id: 'private-unknown-model',
    capabilityOverrides: {
      contextWindow: 16_384,
      maxOutputTokens: 2_048,
      supportsTools: true,
    },
  });
  assert.deepEqual(
    missingRequiredModelCapabilities(
      ['image_input', 'file_input', 'reasoning'],
      snapshotProviderModelCapabilities(unknownPrivateModel),
    ),
    ['image_input', 'file_input', 'reasoning'],
    'unknown private-model capabilities must fail closed instead of using model-name guesses',
  );

  const providerObserved: ProviderModelCapabilityObservation = {
    modelId: 'private-precedence-model',
    source: 'scenario-provider',
    sourceVersion: 'v1',
    capabilities: {
      contextWindow: 32_768,
      maxOutputTokens: 4_096,
      supportsTools: true,
      supportsImageInput: false,
      supportsFileInput: true,
    },
    updatedAt: clock.nowUnixSeconds(),
  };
  const precedenceModel = resolveProviderModelConfig(
    {
      id: providerObserved.modelId,
      capabilityOverrides: { supportsImageInput: true },
    },
    providerObserved,
  );
  assert.deepEqual(
    missingRequiredModelCapabilities(['image_input', 'file_input'], snapshotProviderModelCapabilities(precedenceModel)),
    [],
    'manual override must remain above provider live capability facts',
  );

  const frozenCapabilities = snapshotProviderModelCapabilities(precedenceModel);
  const refreshedModel = resolveProviderModelConfig(
    { id: providerObserved.modelId },
    {
      ...providerObserved,
      sourceVersion: 'v2',
      capabilities: { ...providerObserved.capabilities, supportsImageInput: false },
    },
  );
  assert.deepEqual(missingRequiredModelCapabilities(['image_input'], frozenCapabilities), []);
  assert.deepEqual(
    missingRequiredModelCapabilities(['image_input'], snapshotProviderModelCapabilities(refreshedModel)),
    ['image_input'],
  );

  const providerId = randomUUID();
  const threadId = randomUUID();
  const definitionId = 'scenario.agent';
  const compatibleModel = resolveProviderModelConfig({
    id: 'private-run-model',
    capabilityOverrides: {
      contextWindow: 16_384,
      maxOutputTokens: 2_048,
      supportsTools: true,
      supportsImageInput: true,
      supportsFileInput: false,
      reasoning: { supportedEfforts: ['low', 'medium'], defaultEffort: 'medium' },
    },
  });
  const incompatibleModel = resolveProviderModelConfig({
    id: 'private-run-model',
    capabilityOverrides: {
      contextWindow: 16_384,
      maxOutputTokens: 2_048,
      supportsTools: true,
      supportsImageInput: false,
      supportsFileInput: false,
    },
  });
  const definitionInfo = {
    id: definitionId,
    version: '1.0.0',
    displayName: 'Scenario Agent',
    description: 'Capability contract fixture',
    requiredModelCapabilities: ['tools', 'image_input'] as const,
  };
  const settingsView = {
    revision: 1,
    requestedSettings: { model: { fallbackModels: [] as Array<{ providerId: string; modelId: string }> } },
    effectiveSettings: { feature: { enabled: true } },
    hardLimits: {
      maxRunSteps: 1_000,
      maxActiveExecutionSeconds: 86_400,
      toolTimeoutSeconds: 600,
      maxToolOutputBytes: 16 * 1024 * 1024,
      maxRecallItems: 100,
      maxRecallBytes: 16 * 1024 * 1024,
      maxSubagentMessagesPerRun: 10_000,
      maxSubagentMessageBytesPerRun: 16 * 1024 * 1024,
    },
  };
  const appView = {
    activeVersion: '1.0.0',
    desiredState: 'enabled',
    observedState: 'running',
    acceptNewRuns: true,
    policyRevision: 1,
  };
  const executionPolicy = {
    version: 1,
    effective: {
      maxRunSteps: 100,
      maxActiveExecutionSeconds: 3_600,
      toolTimeoutSeconds: 120,
      maxToolOutputBytes: 1_048_576,
      maxRecallItems: 10,
      maxRecallBytes: 65_536,
      maxSubagentMessages: 100,
      maxSubagentMessageBytes: 1_048_576,
      contextCompactionMode: 'balanced',
      contextProfile: 'normal',
    },
  };
  let currentModel = incompatibleModel;
  let createCommits = 0;
  const runFromCreate = (record: AtomicCreateRun, status: RunView['status'] = 'created'): RunView => ({
    ...record.scope,
    id: record.runId,
    threadId: record.threadId,
    parentRunId: record.parentRunId ?? null,
    status,
    goalStatus: record.initialGoal ? 'in_progress' : 'unknown',
    goal: record.initialGoal ?? { text: null, revision: 0, updatedAt: null },
    verificationStatus: 'not_started',
    needsReconciliation: false,
    budget: record.budget,
    definition: record.definition,
    plan: record.initialPlan ?? { schemaVersion: 1, revision: 0, items: [] },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      steps: 0,
      subagentMessages: 0,
      subagentMessageBytes: 0,
    },
    activeExecutionSeconds: 0,
    activeExecutionStartedAt: null,
    executingRuntimeCount: 0,
    consumedInputSequence: 0,
    inputRevision: 1,
    eventCursor: 0,
    version: 1,
    createdAt: record.now,
    startedAt: null,
    completedAt: null,
    updatedAt: record.now,
  });
  const runService = new RunService(
    { get: async () => settingsView } as never,
    { get: async () => appView } as never,
    {
      get: async () => ({
        id: providerId,
        enabled: true,
        version: 1,
        models: [currentModel],
      }),
    } as never,
    { get: async () => executionPolicy } as never,
    {
      require: () => ({
        ...definitionInfo,
        requiredModelCapabilities: [...definitionInfo.requiredModelCapabilities],
      }),
    } as never,
    async () => {
      throw new Error('SCENARIO_UNEXPECTED_ENVIRONMENT');
    },
    {
      createRun: async (record: AtomicCreateRun) => {
        createCommits += 1;
        return { run: runFromCreate(record), inputSequence: 1, replayed: false };
      },
    } as never,
    null!,
    clock,
  );
  const createCommand = () => ({
    threadId,
    input: { text: 'Exercise the capability contract.', artifactRefs: [] },
    agentDefinitionId: definitionId,
    model: { providerId, modelId: 'private-run-model', configurationVersion: 1 },
    approvalMode: 'ask' as const,
    executionMode: 'execute' as const,
    connectionIds: [],
    command: { key: randomUUID(), requestId: randomUUID() },
  });
  await assert.rejects(() => runService.create(scope, createCommand()), /MODEL_CAPABILITY_UNSUPPORTED/);
  assert.equal(createCommits, 0, 'incompatible Run must fail before durable creation');

  currentModel = compatibleModel;
  const createdRun = await runService.create(scope, createCommand());
  assert.equal(createCommits, 1);
  assert.deepEqual(createdRun.definition.requiredModelCapabilities, ['tools', 'image_input']);
  assert.equal(createdRun.definition.modelCapabilities?.supportsImageInput, true);
  assert.equal(
    createdRun.definition.modelCapabilities?.contextWindow,
    compatibleModel.contextWindow,
    'Run context must come from the frozen model capability, not user settings',
  );
  assert.equal(
    createdRun.definition.modelCapabilities?.maxOutputTokens,
    Math.min(compatibleModel.maxOutputTokens, compatibleModel.contextWindow - 1),
    'Run output ceiling must come from the frozen model capability, not user settings',
  );

  settingsView.requestedSettings.model.fallbackModels = [{ providerId, modelId: 'removed-fallback-model' }];
  const createdWithStaleFallback = await runService.create(scope, createCommand());
  assert.equal(createCommits, 2, 'stale fallback must not block a valid primary Run');
  assert.deepEqual(
    createdWithStaleFallback.definition.rootModelRoutes,
    [],
    'stale fallback must be omitted from the frozen route chain',
  );
  settingsView.requestedSettings.model.fallbackModels = [];

  currentModel = resolveProviderModelConfig({
    id: 'private-run-model',
    capabilityOverrides: {
      contextWindow: 16_384,
      maxOutputTokens: 2_048,
      supportsTools: true,
      supportsImageInput: true,
      supportsFileInput: false,
      reasoning: {
        supportedEfforts: ['none', 'medium'],
        defaultEffort: 'medium',
        mandatory: true,
      },
    },
  });
  await assert.rejects(
    () => runService.create(scope, { ...createCommand(), reasoningEffort: 'none' }),
    /MODEL_REASONING_EFFORT_UNSUPPORTED/,
  );
  assert.equal(createCommits, 2, 'mandatory reasoning rejection must happen before durable creation');

  const checkpointId = randomUUID();
  const terminalSource: RunSnapshot = {
    ...createdRun,
    status: 'cancelled',
    completedAt: clock.nowUnixSeconds(),
    terminalIssue: null,
    recentEntries: [],
  };
  const checkpoint: CheckpointView = {
    id: checkpointId,
    runId: terminalSource.id,
    kind: 'user',
    schemaVersion: 1,
    ledgerThrough: 0,
    eventThrough: 0,
    snapshot: {
      schemaVersion: 1,
      runId: terminalSource.id,
      ledgerThrough: 0,
      planVersion: terminalSource.plan.revision,
      inputRevision: terminalSource.inputRevision,
      settingsRevision: terminalSource.definition.settingsRevision,
      plan: terminalSource.plan,
      goal: terminalSource.goal,
      completedStepIds: [],
      evidenceRefs: [],
      checkpointArtifactRefs: [],
      modelConfigurationVersion: terminalSource.definition.model.configurationVersion,
      activeModel: terminalSource.definition.model,
      definitionVersion: definitionInfo.version,
      policyRevision: 1,
      workspaceArtifactManifestRefs: [],
      workspaceArtifactRefs: [],
      recoveryManifest: {
        schemaVersion: 1,
        eventThrough: 0,
        contextBoundary: { baseThrough: 0, runThrough: {} },
        tools: [],
        delegations: [],
        backgroundJobs: [],
        quarantinedResourceKeys: [],
      },
    },
    createdAt: clock.nowUnixSeconds(),
  };
  let checkpointSource = terminalSource;
  let checkpointCreateCommits = 0;
  currentModel = incompatibleModel;
  const checkpointService = new CheckpointService(
    {
      get: async () => checkpoint,
      missingArtifactRefs: async () => [],
      recoveryHazards: async () => ({ postCheckpointMutationToolCallIds: [], quarantinedResourceKeys: [] }),
    } as never,
    { snapshot: async () => checkpointSource } as never,
    { get: async () => settingsView } as never,
    { get: async () => appView } as never,
    {
      get: async () => ({
        id: providerId,
        enabled: true,
        version: 1,
        models: [currentModel],
      }),
    } as never,
    {
      require: () => ({
        ...definitionInfo,
        requiredModelCapabilities: [...definitionInfo.requiredModelCapabilities],
      }),
    } as never,
    { isDenied: async () => false } as never,
    {
      createRun: async (record: AtomicCreateRun) => {
        checkpointCreateCommits += 1;
        return { run: runFromCreate(record), inputSequence: 0, replayed: false };
      },
      supersedeRunApprovals: async () => 0,
    } as never,
    clock,
  );
  const compatibleValidation = await checkpointService.validate(
    scope,
    terminalSource.id,
    checkpointId,
    terminalSource.version,
  );
  assert.equal(
    compatibleValidation.valid,
    true,
    'provider refresh must not invalidate a checkpoint whose frozen model snapshot satisfies frozen requirements',
  );
  const resumed = await checkpointService.resume(
    scope,
    terminalSource.id,
    checkpointId,
    terminalSource.version,
    randomUUID(),
  );
  assert.equal(checkpointCreateCommits, 1);
  assert.deepEqual(resumed.definition.requiredModelCapabilities, ['tools', 'image_input']);
  assert.equal(resumed.definition.modelCapabilities?.supportsImageInput, true);

  currentModel = compatibleModel;
  checkpointSource = {
    ...terminalSource,
    definition: {
      ...terminalSource.definition,
      requiredModelCapabilities: ['image_input'],
      modelCapabilities: {
        ...terminalSource.definition.modelCapabilities!,
        supportsImageInput: false,
      },
    },
  };
  const incompatibleValidation = await checkpointService.validate(
    scope,
    checkpointSource.id,
    checkpointId,
    checkpointSource.version,
  );
  assert.equal(incompatibleValidation.valid, false);
  assert.ok(incompatibleValidation.reasons.includes('CHECKPOINT_MODEL_CAPABILITY_UNSUPPORTED'));
  await assert.rejects(
    () => checkpointService.resume(scope, checkpointSource.id, checkpointId, checkpointSource.version, randomUUID()),
    /CHECKPOINT_MODEL_CAPABILITY_UNSUPPORTED/,
  );
  assert.equal(
    checkpointCreateCommits,
    1,
    'incompatible frozen checkpoint must fail before resumed Run creation even when live model capabilities improved',
  );

  return [
    { name: 'typed_requirements', value: 4, unit: 'capabilities' },
    { name: 'removed_streaming_aliases', value: 0, unit: 'requirements' },
    { name: 'incompatible_run_commits', value: 0, unit: 'runs' },
    { name: 'compatible_run_commits', value: createCommits, unit: 'runs' },
    { name: 'compatible_checkpoint_resumes', value: checkpointCreateCommits, unit: 'runs' },
    { name: 'frozen_checkpoint_capability_rejections', value: 1, unit: 'runs' },
  ];
};
