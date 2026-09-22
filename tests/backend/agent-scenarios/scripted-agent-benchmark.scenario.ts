import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { ToolExecutor } from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import type { AgentTool, ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { AppCapabilityBroker } from '../../../packages/backend/src/modules/agent/host/app-capability-broker';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import type { TokenUsage } from '../../../packages/backend/src/modules/agent/ai/model.types';
import { ProviderService } from '../../../packages/backend/src/modules/agent/ai/provider.service';
import type { LedgerEntryView } from '../../../packages/backend/src/modules/agent/ai/conversation.repository.port';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import { SkillRegistry } from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import { ModelStepRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/model-step-runner';
import { clock, emptyModelContinuations } from './scenario-fixtures';
import {
  assertValidToolExchange,
  EmptyRecallRepository,
  StaticConversationRepository,
} from './scenario-context-helpers';
import {
  AgentBenchmarkCase,
  benchmarkProvider,
  benchmarkSnapshot,
  drainGenerator,
  ScenarioModelCallLimiter,
  ScriptedLanguageModel,
  StaticProviderRepository,
} from './scenario-benchmark-helpers';

export const scriptedAgentBenchmarkScenario = async () => {
  const benchmarks: readonly AgentBenchmarkCase[] = [
    {
      id: 'coding',
      prompt: 'Inspect src/example.ts and report the exported function name.',
      toolName: 'scenario_read_file',
      toolArgumentsJson: JSON.stringify({ path: 'src/example.ts' }),
      toolDescription: 'Read a deterministic source file fixture.',
      toolInputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
      toolSummary: 'src/example.ts exports function solveExample().',
      finalText: 'The exported function is solveExample().',
      usage: [
        { inputTokens: 180, outputTokens: 24, cachedInputTokens: 80 },
        { inputTokens: 236, outputTokens: 18, cachedInputTokens: 160 },
      ],
    },
    {
      id: 'operations',
      prompt: 'Check the api service status and report whether it is healthy.',
      toolName: 'scenario_service_status',
      toolArgumentsJson: JSON.stringify({ service: 'api' }),
      toolDescription: 'Read a deterministic service-health fixture.',
      toolInputSchema: {
        type: 'object',
        properties: { service: { type: 'string' } },
        required: ['service'],
        additionalProperties: false,
      },
      toolSummary: 'api is healthy; desired=1 ready=1.',
      finalText: 'The api service is healthy (1/1 ready).',
      usage: [
        { inputTokens: 164, outputTokens: 20, cachedInputTokens: 72 },
        { inputTokens: 218, outputTokens: 17, cachedInputTokens: 144 },
      ],
    },
  ];

  let taskSuccesses = 0;
  let modelSteps = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let duplicateReadSearchCalls = 0;
  let verifiedCases = 0;
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

  for (const benchmark of benchmarks) {
    const benchmarkScope: Scope = { userId: 1, appId: `benchmark-${benchmark.id}-app` };
    const snapshot = benchmarkSnapshot(benchmark, benchmarkScope);
    const initialEntry: LedgerEntryView = {
      id: `${benchmark.id}-input`,
      threadId: snapshot.threadId,
      runId: snapshot.id,
      sequence: 1,
      kind: 'user_input',
      payload: { text: benchmark.prompt, artifactRefs: [] },
      createdAt: snapshot.createdAt,
    };
    const conversationRepository = new StaticConversationRepository([initialEntry]);
    const conversations = new ConversationService(conversationRepository, clock, null!, null!);
    const context = new ContextService(
      conversations,
      new RecallService(new EmptyRecallRepository(), clock),
      new SkillRegistry(),
      emptyModelContinuations,
      null!,
    );

    const toolCallId = `${benchmark.id}-tool-call`;
    const argumentMidpoint = Math.max(1, Math.floor(benchmark.toolArgumentsJson.length / 2));
    const scriptedModel = new ScriptedLanguageModel([
      {
        assertRequest: (request) => {
          assert.ok(
            request.messages.some((message) => message.role === 'user' && message.content.includes(benchmark.prompt)),
            `${benchmark.id}: first model step must include current user input`,
          );
        },
        events: [
          { type: 'tool.delta', index: 0, id: toolCallId, name: benchmark.toolName },
          { type: 'tool.delta', index: 0, argumentsDelta: benchmark.toolArgumentsJson.slice(0, argumentMidpoint) },
          { type: 'tool.delta', index: 0, argumentsDelta: benchmark.toolArgumentsJson.slice(argumentMidpoint) },
          { type: 'usage', usage: benchmark.usage[0] },
          { type: 'completed', finishReason: 'tool-calls' },
        ],
      },
      {
        assertRequest: (request) => {
          const assistant = request.messages.find(
            (message) => message.role === 'assistant' && message.toolCalls?.some((call) => call.id === toolCallId),
          );
          const result = request.messages.find(
            (message) => message.role === 'tool' && message.toolCallId === toolCallId,
          );
          assert.ok(assistant, `${benchmark.id}: second model step must retain the assistant tool call`);
          assert.ok(
            result?.content.includes(benchmark.toolSummary),
            `${benchmark.id}: second model step must include tool output`,
          );
        },
        events: [
          { type: 'message.delta', text: benchmark.finalText },
          { type: 'usage', usage: benchmark.usage[1] },
          { type: 'completed', finishReason: 'stop' },
        ],
      },
    ]);
    const providers = new ProviderService(new StaticProviderRepository(benchmarkProvider), scriptedModel, clock);
    const modelRunner = new ModelStepRunner(providers, context, scriptedModel, new ScenarioModelCallLimiter());

    const catalog = new ToolCatalog();
    const executedKeys = new Set<string>();
    let duplicateCallsForCase = 0;
    const benchmarkTool: AgentTool = {
      descriptor: {
        name: benchmark.toolName,
        version: '1',
        description: benchmark.toolDescription,
        inputSchema: benchmark.toolInputSchema,
        riskClass: 'read',
      },
      inspect: async (input, toolContext, policyRevision) => ({
        toolName: benchmark.toolName,
        toolVersion: '1',
        normalizedArguments: input,
        target: {
          kind: 'run',
          targetIdentity: `run:${toolContext.runId}`,
          endpoint: `run:${toolContext.runId}`,
          loginUser: `agent-runtime:${toolContext.agentRuntimeId}`,
          configurationHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
        },
        resourceKeys: [`benchmark:${benchmark.id}`],
        risk: 'read',
        mutation: false,
        operationHash: createHash('sha256')
          .update(`${benchmark.toolName}:${JSON.stringify(input)}`)
          .digest('hex'),
        operationHashVersion: 1,
        preconditions: [],
        policyRevision,
        inputRevision: toolContext.inputRevision,
      }),
      execute: async (inspection) => {
        const key = `${inspection.toolName}:${JSON.stringify(inspection.normalizedArguments)}`;
        if (executedKeys.has(key)) duplicateCallsForCase += 1;
        executedKeys.add(key);
        return {
          ok: true,
          summary: benchmark.toolSummary,
          artifactRefs: [],
          truncated: false,
          outcome: 'confirmed',
          verification: { status: 'verified', summary: 'Deterministic fixture verified.', evidenceRefs: [] },
        };
      },
    };
    catalog.registerContribution({
      schemaVersion: 1,
      id: `scenario.benchmark-${benchmark.id}`,
      tools: [benchmarkTool],
    });
    const capabilities = {
      authorize: async () => ({ allowed: true as const, policyRevision: 1 }),
    } as unknown as AppCapabilityBroker;
    const executor = new ToolExecutor(catalog, capabilities);
    const signal = new AbortController().signal;

    const firstPrepared = await modelRunner.prepare(snapshot, benchmarkScope, catalog.schemas(benchmarkScope), {});
    const first = await drainGenerator(
      modelRunner.runAttempt(
        snapshot,
        firstPrepared.contextPlan,
        { attemptId: `${benchmark.id}-attempt-1`, attemptIndex: 1 },
        signal,
      ),
    );
    assert.equal(first.error, undefined, `${benchmark.id}: first model step must succeed`);
    assert.equal(first.finishReason, 'tool-calls');
    const proposed = first.toolCalls.get(0);
    assert.equal(proposed?.id, toolCallId);
    assert.equal(proposed?.name, benchmark.toolName);
    assert.equal(proposed?.argumentsJson, benchmark.toolArgumentsJson);
    assert.ok(first.usage, `${benchmark.id}: first model step must report usage`);
    modelSteps += 1;

    const toolContext: ToolContext = {
      ...benchmarkScope,
      actor: {
        kind: 'agent',
        userId: benchmarkScope.userId,
        appId: benchmarkScope.appId,
        runId: snapshot.id,
        agentRuntimeId: `${benchmark.id}-runtime`,
      },
      runId: snapshot.id,
      agentRuntimeId: `${benchmark.id}-runtime`,
      connectionIds: [],
      environment: null,
      stepId: `${benchmark.id}-step-1`,
      signal,
      deadlineAt: snapshot.createdAt + 60,
      maxOutputBytes: snapshot.budget.maxToolOutputBytes,
      inputRevision: snapshot.inputRevision,
    };
    const executed = await executor.invoke(toolContext, {
      name: proposed!.name!,
      argumentsJson: proposed!.argumentsJson,
    });
    toolCalls += 1;
    assert.equal(executed.result.outcome, 'confirmed');
    assert.equal(executed.result.verification.status, 'verified');

    await conversationRepository.appendEntry(benchmarkScope, snapshot.threadId, {
      id: `${benchmark.id}-assistant-tool`,
      runId: snapshot.id,
      kind: 'assistant_message',
      payload: {
        text: first.text,
        toolCalls: [
          {
            id: proposed!.id!,
            name: proposed!.name!,
            argumentsJson: proposed!.argumentsJson,
          },
        ],
      },
      createdAt: snapshot.createdAt + 1,
    });
    await conversationRepository.appendEntry(benchmarkScope, snapshot.threadId, {
      id: `${benchmark.id}-tool-result`,
      runId: snapshot.id,
      kind: 'tool_result',
      payload: { toolCallId, content: executed.result.summary },
      createdAt: snapshot.createdAt + 2,
    });

    const secondPrepared = await modelRunner.prepare(snapshot, benchmarkScope, catalog.schemas(benchmarkScope), {});
    assertValidToolExchange(secondPrepared.contextPlan.messages);
    const second = await drainGenerator(
      modelRunner.runAttempt(
        snapshot,
        secondPrepared.contextPlan,
        { attemptId: `${benchmark.id}-attempt-2`, attemptIndex: 1 },
        signal,
      ),
    );
    assert.equal(second.error, undefined, `${benchmark.id}: second model step must succeed`);
    assert.equal(second.finishReason, 'stop');
    assert.equal(second.text, benchmark.finalText);
    assert.ok(second.usage, `${benchmark.id}: second model step must report usage`);
    modelSteps += 1;

    scriptedModel.assertConsumed();
    modelCalls += scriptedModel.requests.length;
    duplicateReadSearchCalls += duplicateCallsForCase;
    const verified = executed.result.verification.status === 'verified';
    if (verified) verifiedCases += 1;
    if (verified && second.text === benchmark.finalText) taskSuccesses += 1;
    for (const usage of [first.usage!, second.usage!]) {
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;
      totalUsage.cachedInputTokens += usage.cachedInputTokens;
    }
  }

  assert.equal(taskSuccesses, benchmarks.length, 'every deterministic benchmark task must succeed');
  assert.equal(verifiedCases, benchmarks.length, 'every benchmark tool outcome must be verified');
  assert.equal(duplicateReadSearchCalls, 0, 'benchmark must not duplicate read/search work');

  return [
    { name: 'benchmark_cases', value: benchmarks.length, unit: 'cases' },
    { name: 'task_successes', value: taskSuccesses, unit: 'cases' },
    { name: 'model_steps', value: modelSteps, unit: 'steps' },
    { name: 'model_calls', value: modelCalls, unit: 'calls' },
    { name: 'tool_calls', value: toolCalls, unit: 'calls' },
    { name: 'duplicate_read_search_calls', value: duplicateReadSearchCalls, unit: 'calls' },
    { name: 'input_tokens', value: totalUsage.inputTokens, unit: 'tokens' },
    { name: 'output_tokens', value: totalUsage.outputTokens, unit: 'tokens' },
    { name: 'cached_input_tokens', value: totalUsage.cachedInputTokens, unit: 'tokens' },
    { name: 'verified_cases', value: verifiedCases, unit: 'cases' },
  ];
};
