import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { parseRunDefinition } from '../../../packages/backend/src/infrastructure/agent/runtime/durable-state-decoders';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { ToolExecutor } from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import type { AgentTool, ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { AppCapabilityBroker } from '../../../packages/backend/src/modules/agent/host/app-capability-broker';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import { resolveProviderModelConfig } from '../../../packages/backend/src/modules/agent/ai/model-capability-resolver';
import { ProviderService } from '../../../packages/backend/src/modules/agent/ai/provider.service';
import type { LedgerEntryView } from '../../../packages/backend/src/modules/agent/ai/conversation.repository.port';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import { SkillRegistry } from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import { completionGateDecision } from '../../../packages/backend/src/modules/agent/runtime/execution/completion-gate';
import { ModelStepRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/model-step-runner';
import { ToolCallRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/tool-call-runner';
import { createRequestUserInputTool } from '../../../packages/backend/src/modules/agent/tools/host/user-input-tools';
import { createPlanUpdateTool } from '../../../packages/backend/src/modules/agent/runtime/planning/plan-tool';
import { RunService } from '../../../packages/backend/src/modules/agent/runtime/runs/run.service';
import type { AtomicCreateRun } from '../../../packages/backend/src/modules/agent/runtime/runs/state-commit.port';
import type { RunSnapshot } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { parseCreateRunRequest } from '../../../packages/backend/src/interfaces/http/agent/agent-runtime-route-input';
import { clock, emptyModelContinuations } from './scenario-fixtures';
import { EmptyRecallRepository, StaticConversationRepository } from './scenario-context-helpers';
import {
  AgentBenchmarkCase,
  benchmarkProvider,
  benchmarkSnapshot,
  collectBackendSignals,
  ScenarioModelCallLimiter,
  ScriptedLanguageModel,
  StaticProviderRepository,
} from './scenario-benchmark-helpers';

export const planExecutionModeScenario = async () => {
  const scope: Scope = { userId: 1, appId: 'plan-mode-app' };
  const cryptoHash = { sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex') };
  const catalog = new ToolCatalog();
  const tool = (name: string, riskClass: 'read' | 'mutate'): AgentTool => ({
    descriptor: {
      name,
      version: '1',
      description: `${riskClass} fixture`,
      inputSchema: { type: 'object', additionalProperties: false },
      riskClass,
    },
    inspect: async (input, context, policyRevision) => ({
      toolName: name,
      toolVersion: '1',
      normalizedArguments: input,
      target: {
        kind: 'run',
        targetIdentity: `run:${context.runId}:${name}`,
        endpoint: `run:${context.runId}`,
        loginUser: `agent-runtime:${context.agentRuntimeId}`,
        configurationHash: `plan-${name}`,
      },
      resourceKeys: [],
      risk: riskClass,
      mutation: riskClass === 'mutate',
      operationHash: `plan-${name}`,
      operationHashVersion: 1,
      preconditions: [],
      policyRevision,
      inputRevision: context.inputRevision,
    }),
    execute: async () => ({
      ok: true,
      summary: `${name} executed`,
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: { status: 'verified', summary: 'fixture', evidenceRefs: [] },
    }),
  });
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.plan-mode',
    tools: [
      tool('scenario_plan_read', 'read'),
      tool('scenario_plan_mutation', 'mutate'),
      createPlanUpdateTool(null!, null!, cryptoHash),
      createRequestUserInputTool(cryptoHash),
    ],
  });
  const capabilities = {
    authorize: async () => ({ allowed: true as const, policyRevision: 1 }),
  } as unknown as AppCapabilityBroker;
  const executor = new ToolExecutor(catalog, capabilities);
  const runner = new ToolCallRunner(catalog, executor, { decide: () => ({ action: 'allow' }) } as never, null!, null!);
  const planSchemas = runner.schemas(scope, undefined, 'plan');
  assert.deepEqual(
    planSchemas.map((item) => item.name).sort(),
    ['plan_update', 'request_user_input', 'scenario_plan_read'],
    'plan mode model surface must retain read/control tools and exclude mutation tools',
  );

  const context: ToolContext = {
    ...scope,
    actor: { kind: 'agent', userId: 1, appId: scope.appId, runId: 'plan-run', agentRuntimeId: 'plan-runtime' },
    runId: 'plan-run',
    agentRuntimeId: 'plan-runtime',
    connectionIds: [],
    environment: null,
    stepId: 'plan-step',
    signal: new AbortController().signal,
    deadlineAt: 1_800_900_000,
    maxOutputBytes: 64 * 1024,
    inputRevision: 1,
  };
  await assert.rejects(
    () =>
      runner.inspect(
        context,
        { providerCallId: 'forged', name: 'scenario_plan_mutation', argumentsJson: '{}' },
        'plan',
      ),
    /PLAN_MODE_TOOL_FORBIDDEN/,
    'a forged mutation tool call must fail closed even when the tool exists in the catalog',
  );

  const parsed = parseCreateRunRequest({
    schemaVersion: 1,
    threadId: randomUUID(),
    input: { text: 'Prepare a plan.', artifactRefs: [] },
    agentDefinitionId: 'scenario-agent',
    model: { providerId: randomUUID(), modelId: 'scenario-model', configurationVersion: 1 },
    approvalMode: 'full_access',
    executionMode: 'plan',
    connectionIds: [],
  });
  assert.equal(parsed.executionMode, 'plan');
  assert.equal(parsed.approvalMode, 'full_access', 'executionMode must remain orthogonal to approvalMode');
  assert.throws(
    () =>
      parseCreateRunRequest({
        schemaVersion: 1,
        threadId: randomUUID(),
        input: { text: 'Execute normally.', artifactRefs: [] },
        agentDefinitionId: 'scenario-agent',
        model: { providerId: randomUUID(), modelId: 'scenario-model', configurationVersion: 1 },
        approvalMode: 'ask',
        connectionIds: [],
      }),
    /VALIDATION_FAILED/,
    'omitted executionMode must fail closed instead of selecting an implicit execution mode',
  );

  const planBenchmark: AgentBenchmarkCase = {
    id: 'coding',
    prompt: 'Prepare a durable implementation plan only.',
    toolName: 'scenario_plan_read',
    toolArgumentsJson: '{}',
    toolDescription: 'read fixture',
    toolInputSchema: { type: 'object', additionalProperties: false },
    toolSummary: 'read complete',
    finalText: 'plan ready',
    usage: [
      { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0 },
      { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0 },
    ],
  };
  const snapshot = benchmarkSnapshot(planBenchmark, scope);
  snapshot.definition.executionMode = 'plan';
  assert.equal(parseRunDefinition(JSON.stringify(snapshot.definition)).executionMode, 'plan');
  assert.throws(
    () => parseRunDefinition(JSON.stringify({ ...snapshot.definition, executionMode: 'unsafe' })),
    /AGENT_DURABLE_STATE_INVALID/,
    'durable executionMode decoder must fail closed on unknown values',
  );
  const inputEntry: LedgerEntryView = {
    id: 'plan-mode-input',
    threadId: snapshot.threadId,
    runId: snapshot.id,
    sequence: 1,
    kind: 'user_input',
    payload: { text: planBenchmark.prompt, artifactRefs: [] },
    createdAt: snapshot.createdAt,
  };
  const conversations = new ConversationService(new StaticConversationRepository([inputEntry]), clock, null!, null!);
  const modelContext = new ContextService(
    conversations,
    new RecallService(new EmptyRecallRepository(), clock),
    new SkillRegistry(),
    emptyModelContinuations,
    null!,
  );
  const scriptedModel = new ScriptedLanguageModel([
    {
      assertRequest: (request) => {
        assert.deepEqual(
          request.tools.map((item) => item.name).sort(),
          ['plan_update', 'request_user_input', 'scenario_plan_read'],
          'the actual model request must not contain mutation tool schemas in plan mode',
        );
      },
      events: [
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0 } },
        { type: 'completed', finishReason: 'stop' },
      ],
    },
  ]);
  const providers = new ProviderService(new StaticProviderRepository(benchmarkProvider), scriptedModel, clock);
  const modelRunner = new ModelStepRunner(providers, modelContext, scriptedModel, new ScenarioModelCallLimiter());
  const prepared = await modelRunner.prepare(snapshot, scope, planSchemas, {});
  const modelResult = await collectBackendSignals(
    modelRunner.runAttempt(
      snapshot,
      prepared.contextPlan,
      { attemptId: 'plan-attempt', attemptIndex: 1 },
      context.signal,
    ),
  );
  assert.equal(modelResult.result.error, undefined);
  scriptedModel.assertConsumed();

  const gate = completionGateDecision(
    {
      definition: { executionMode: 'plan' },
      plan: {
        schemaVersion: 1,
        revision: 1,
        items: [
          {
            id: 'implement',
            title: 'Implement after approval',
            detail: null,
            status: 'pending',
            dependsOn: [],
            evidenceRefs: [],
          },
        ],
      },
    } as unknown as RunSnapshot,
    { tools: [], readyEvidenceRefs: [], gateBlocksSinceToolProgress: 0 },
    'Prepare a plan.',
  );
  assert.equal(
    gate.kind,
    'complete',
    'pending durable plan items are the output of a plan-only Run, not unfinished execution',
  );

  const providerId = randomUUID();
  const threadId = randomUUID();
  const sourceRunId = randomUUID();
  const resolvedModel = resolveProviderModelConfig({
    id: 'plan-lineage-model',
    capabilityOverrides: { contextWindow: 8_192, maxOutputTokens: 1_024, supportsTools: true },
  });
  const sourcePlan: RunSnapshot['plan'] = {
    schemaVersion: 1,
    revision: 2,
    items: [
      {
        id: 'implementation',
        title: 'Implement the approved change',
        detail: 'Execute in a separate Run.',
        status: 'pending',
        dependsOn: [],
        evidenceRefs: ['artifact:plan-evidence'],
      },
    ],
  };
  const sourcePlanRun = {
    ...snapshot,
    ...scope,
    id: sourceRunId,
    threadId,
    status: 'completed_unverified',
    completedAt: 1_800_000_100,
    definition: {
      ...snapshot.definition,
      executionMode: 'plan',
      model: { providerId, modelId: resolvedModel.id, configurationVersion: 1 },
    },
    plan: sourcePlan,
    goal: { text: 'Ship the planned change.', revision: 1, updatedAt: 1_800_000_000 },
  } as RunSnapshot;
  let createRecord: AtomicCreateRun | null = null;
  const lineageRunService = new RunService(
    {
      get: async () => ({
        revision: 1,
        requestedSettings: { model: { fallbackModels: [] } },
        effectiveSettings: { feature: { enabled: true } },
      }),
    } as never,
    {
      get: async () => ({
        activeVersion: '1.0.0',
        desiredState: 'enabled',
        observedState: 'running',
        acceptNewRuns: true,
        policyRevision: 1,
      }),
    } as never,
    { get: async () => ({ id: providerId, enabled: true, version: 1, models: [resolvedModel] }) } as never,
    {
      get: async () => ({
        version: 1,
        effective: {
          maxRunSteps: 100,
          maxActiveExecutionSeconds: 3_600,
          toolTimeoutSeconds: 120,
          maxToolOutputBytes: 1_048_576,
          maxRecallItems: 5,
          maxRecallBytes: 8_192,
          maxSubagentMessages: 100,
          maxSubagentMessageBytes: 1_048_576,
          contextCompactionMode: 'balanced',
          contextProfile: 'normal',
        },
      }),
    } as never,
    { require: () => ({ id: 'scenario-agent', version: '1.0.0', requiredModelCapabilities: [] }) } as never,
    async () => {
      throw new Error('SCENARIO_UNEXPECTED_ENVIRONMENT');
    },
    {
      createRun: async (record: AtomicCreateRun) => {
        createRecord = record;
        return {
          run: {
            ...sourcePlanRun,
            id: record.runId,
            parentRunId: record.parentRunId ?? null,
            status: 'created',
            completedAt: null,
            definition: record.definition,
            plan: record.initialPlan ?? { schemaVersion: 1, revision: 0, items: [] },
            goal: record.initialGoal ?? { text: null, revision: 0, updatedAt: null },
          },
          inputSequence: 1,
          replayed: false,
        };
      },
    } as never,
    { snapshot: async (_scope: Scope, runId: string) => (runId === sourceRunId ? sourcePlanRun : null) } as never,
    clock,
  );
  const executeFromPlan = await lineageRunService.create(scope, {
    threadId,
    input: { text: 'Execute the approved plan.', artifactRefs: [] },
    agentDefinitionId: 'scenario-agent',
    model: { providerId, modelId: resolvedModel.id, configurationVersion: 1 },
    approvalMode: 'full_access',
    executionMode: 'execute',
    plannedFromRunId: sourceRunId,
    connectionIds: [],
    command: { key: randomUUID(), requestId: randomUUID() },
  });
  assert.ok(createRecord);
  assert.equal(createRecord.parentRunId, sourceRunId, 'parentRunId remains the single durable Run lineage authority');
  assert.deepEqual(
    createRecord.initialPlan,
    sourcePlan,
    'execute Run must inherit the durable plan including evidence refs',
  );
  assert.equal(
    createRecord.initialGoal?.text,
    sourcePlanRun.goal.text,
    'execute Run inherits the plan Run goal when no new goal is supplied',
  );
  assert.equal(executeFromPlan.definition.executionMode, 'execute');
  assert.equal(
    executeFromPlan.definition.approvalMode,
    'full_access',
    'plan confirmation must not override execute Run approval mode',
  );
  await assert.rejects(
    () =>
      lineageRunService.create(scope, {
        threadId,
        input: { text: 'Invalid chained plan.', artifactRefs: [] },
        agentDefinitionId: 'scenario-agent',
        model: { providerId, modelId: resolvedModel.id, configurationVersion: 1 },
        approvalMode: 'ask',
        executionMode: 'plan',
        plannedFromRunId: sourceRunId,
        connectionIds: [],
        command: { key: randomUUID(), requestId: randomUUID() },
      }),
    /VALIDATION_FAILED/,
    'plannedFromRunId is only valid when starting a separate execute Run',
  );

  return [
    { name: 'plan_model_surface_mutations', value: 0, unit: 'tools' },
    { name: 'forged_plan_mutations_allowed', value: 0, unit: 'tools' },
    { name: 'plan_control_tools_available', value: 2, unit: 'tools' },
    { name: 'planned_execute_lineage_links', value: createRecord?.parentRunId === sourceRunId ? 1 : 0, unit: 'runs' },
  ];
};
