import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDefaultAgentSettings } from '../../../packages/backend/src/modules/agent/agent-defaults';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { SqliteCheckpointRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-checkpoint.repository';
import { SqliteConversationRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-conversation.repository';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import { SkillRegistry } from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import { ProviderService } from '../../../packages/backend/src/modules/agent/ai/provider.service';
import { ModelStepRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/model-step-runner';
import { NativeAgentBackend } from '../../../packages/backend/src/modules/agent/runtime/execution/native-agent-backend';
import { ToolCallRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/tool-call-runner';
import { PolicyService } from '../../../packages/backend/src/modules/agent/capabilities/policy.service';
import type { ToolInspection, ToolResult } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import type { RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { clock, emptyModelContinuations, scope } from './scenario-fixtures';
import { EmptyRecallRepository } from './scenario-context-helpers';
import {
  benchmarkSnapshot,
  benchmarkProvider,
  ScenarioModelCallLimiter,
  ScriptedLanguageModel,
  StaticProviderRepository,
} from './scenario-benchmark-helpers';

export const adaptiveExecutionBudgetScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-adaptive-budget-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'budget.sqlite', nodeEnv: 'test' });
  const commit = new SqliteStateCommitAdapter(db);
  const runs = new SqliteRunRepository(db);
  const checkpoints = new SqliteCheckpointRepository(db);
  const now = clock.nowUnixSeconds();
  const benchmark = {
    id: 'adaptive',
    prompt: 'Inspect the service and verify its deployment.',
    toolName: 'scenario_read',
    toolArgumentsJson: '{}',
    toolDescription: 'Read service state.',
    toolInputSchema: { type: 'object' },
    toolSummary: 'Observed service.',
    finalText: 'Report.',
    usage: [
      { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
    ] as const,
  };
  const base = benchmarkSnapshot(benchmark, scope);

  const create = async (initial = 10, ceiling = 40, toolLimit = 100, parentRunId?: string) => {
    const threadId = randomUUID();
    const runtimeId = randomUUID();
    await db.execute(
      `INSERT INTO ai_threads (id,user_id,app_id,title,title_source,created_at,updated_at)
      VALUES (?,1,?,'budget','manual',?,?)`,
      [threadId, scope.appId, now, now],
    );
    const result = await commit.createRun({
      scope,
      runId: randomUUID(),
      runtimeId,
      threadId,
      inputEntryId: randomUUID(),
      ...(parentRunId ? { parentRunId } : {}),
      input: { text: benchmark.prompt, artifactRefs: [] },
      initialGoal: base.goal,
      agentDefinitionId: base.definition.agentDefinitionId,
      model: base.definition.model,
      connectionIds: [],
      budget: { ...base.budget, maxModelRequests: initial, modelRequestCeiling: ceiling, maxToolExecutions: toolLimit },
      definition: base.definition,
      expectedPolicyRevision: 1,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      requestId: randomUUID(),
      now,
    });
    return { run: result.run, runtimeId };
  };
  const begin = async (run: RunView, runtimeId: string) =>
    commit.beginModelStep({
      scope,
      runId: run.id,
      runtimeId,
      expectedRunVersion: run.version,
      inputWatermark: run.inputRevision,
      reservedTokens: 2,
      estimatedInputTokens: 1,
      reservedOutputTokens: 1,
      contextWindowTokens: 16384,
      purpose: 'compaction',
      now,
    });
  const compact = async (run: RunView, runtimeId: string) => {
    const begun = await begin(run, runtimeId);
    return (
      await commit.completeCompactionStep({
        scope,
        runId: run.id,
        runtimeId,
        stepId: begun.stepId,
        attemptId: begun.attemptId,
        inputWatermark: run.inputRevision,
        goalRevision: run.goal.revision,
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: 0,
        estimatedUsage: false,
        now,
      })
    ).run;
  };
  const inspection = (run: RunView, operationHash = 'service-observation'): ToolInspection => ({
    toolName: 'scenario_read',
    toolVersion: '1',
    normalizedArguments: { service: 'api' },
    target: {
      kind: 'run',
      targetIdentity: `run:${run.id}`,
      endpoint: `run:${run.id}`,
      loginUser: 'scenario',
      configurationHash: 'service',
    },
    resourceKeys: [],
    risk: 'read',
    mutation: false,
    operationHash,
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: 1,
    inputRevision: run.inputRevision,
  });
  const toolResult: ToolResult = {
    ok: true,
    summary: 'Service state observed.',
    outcome: 'confirmed',
    data: { service: 'api', ready: 1 },
    artifactRefs: [],
    truncated: false,
    verification: { status: 'verified', summary: 'Service observation verified.', evidenceRefs: [] },
  };
  const propose = async (run: RunView, runtimeId: string, count = 1) => {
    const begun = await begin(run, runtimeId);
    return commit.commitToolProposalBatch({
      scope,
      runId: run.id,
      runtimeId,
      modelStepId: begun.stepId,
      attemptId: begun.attemptId,
      assistantEntryId: randomUUID(),
      assistantText: '',
      expectedRunVersion: begun.run.version,
      items: Array.from({ length: count }, () => ({
        providerCallId: randomUUID(),
        toolCallId: randomUUID(),
        toolName: 'scenario_read',
        toolVersion: '1',
        argumentsJson: '{"service":"api"}',
        inspection: inspection(begun.run),
      })),
      usage: begun.run.usage,
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      estimatedUsage: false,
      finishReason: 'tool-calls',
      now,
    });
  };
  const observe = async (run: RunView, runtimeId: string) => {
    const proposed = await propose(run, runtimeId);
    const started = await commit.beginReadToolBatch({
      scope,
      runId: run.id,
      runtimeId,
      expectedRunVersion: proposed.run.version,
      items: proposed.items,
      now,
    });
    return (
      await commit.settleReadToolBatch({
        scope,
        runId: run.id,
        runtimeId,
        expectedRunVersion: started.run.version,
        items: proposed.items.map((item) => ({
          ...item,
          toolResultEntryId: randomUUID(),
          result: toolResult,
        })),
        now,
      })
    ).run;
  };

  try {
    await db.initialize();
    await db.execute("INSERT INTO users(id,username,hashed_password) VALUES(1,'adaptive-user','unused')");
    await db.execute(
      `INSERT INTO agent_apps(user_id,app_id,active_version,desired_state,observed_state,created_at,updated_at)
      VALUES(1,?,'1.0.0','enabled','running',?,?)`,
      [scope.appId, now, now],
    );

    const progressive = await create();
    let run = progressive.run;
    for (let index = 0; index < 7; index++) run = await compact(run, progressive.runtimeId);
    run = await observe(run, progressive.runtimeId);
    assert.equal(run.usage.modelRequests, 8);
    assert.equal(run.usage.toolExecutions, 1, 'tool execution does not consume another model request');
    await db.execute('UPDATE agent_runs SET active_execution_seconds = ? WHERE id = ?', [
      run.budget.maxActiveExecutionSeconds + 1,
      run.id,
    ]);
    const extensions = await Promise.all(
      Array.from({ length: 3 }, () => commit.advanceExecutionBudget({ scope, runId: run.id, now })),
    );
    assert.equal(
      extensions.flatMap((item) => item.committedEvents).filter((event) => event.type === 'budget.auto_extended')
        .length,
      1,
    );
    run = (await runs.snapshot(scope, run.id))!;
    assert.equal(run.budget.maxModelRequests, 15);
    assert.equal(
      run.budget.maxActiveExecutionSeconds,
      Math.ceil(progressive.run.budget.maxActiveExecutionSeconds * 1.5),
      'soft time allowance extends at a safe boundary instead of interrupting admitted work',
    );
    assert.equal(run.budget.extensionCount, 1);
    assert.equal(run.status, 'running');
    run = await observe(run, progressive.runtimeId); // Same successful action/data is not fresh progress.
    while (run.usage.modelRequests < 13) run = await compact(run, progressive.runtimeId);
    const finishing = await commit.advanceExecutionBudget({ scope, runId: run.id, now });
    assert.equal(finishing.run.budget.phase, 'finishing');
    assert.equal(finishing.run.budget.stopReason, 'no_progress');
    assert.equal(
      finishing.run.budget.extensionCount,
      1,
      'neither old evidence nor an identical replay renews the allowance',
    );

    const parallel = await create(2, 2);
    const admissions = await Promise.allSettled(
      Array.from({ length: 3 }, () => begin(parallel.run, parallel.runtimeId)),
    );
    assert.equal(admissions.filter((item) => item.status === 'fulfilled').length, 2);
    const denied = admissions.find((item) => item.status === 'rejected');
    assert.ok(denied && denied.status === 'rejected' && denied.reason.message === 'RUN_BUDGET_EXCEEDED');
    assert.equal((await runs.snapshot(scope, parallel.run.id))!.usage.modelRequests, 2);

    const limitedTools = await create(10, 40, 1);
    const proposed = await propose(limitedTools.run, limitedTools.runtimeId, 2);
    await assert.rejects(
      () =>
        commit.beginReadToolBatch({
          scope,
          runId: limitedTools.run.id,
          runtimeId: limitedTools.runtimeId,
          expectedRunVersion: proposed.run.version,
          items: proposed.items,
          now,
        }),
      /RUN_BUDGET_EXCEEDED/,
    );
    assert.equal((await runs.snapshot(scope, limitedTools.run.id))!.usage.toolExecutions, 0);
    assert.equal((await runs.pendingTools(scope, limitedTools.run.id)).length, 2, 'oversized batch starts no tool');

    const partial = await create(4, 4);
    run = await compact(partial.run, partial.runtimeId);
    run = await compact(run, partial.runtimeId);
    await db.execute(
      `UPDATE agent_runs SET plan_json = ?, goal_text = 'Verify the new deployment', goal_revision = 2 WHERE id = ?`,
      [
        JSON.stringify({
          schemaVersion: 1,
          revision: 2,
          items: [
            {
              id: 'verify',
              title: 'Verify deployment',
              detail: null,
              status: 'pending',
              dependsOn: [],
              evidenceRefs: [],
            },
          ],
        }),
        run.id,
      ],
    );
    const scriptedModel = new ScriptedLanguageModel([
      {
        assertRequest: (request) => {
          assert.equal(request.toolMode, 'none');
          const content = request.messages.map((message) => message.content).join('\n');
          assert.ok(content.includes('Verify the new deployment') && content.includes('Verify deployment'));
          assert.ok(content.includes('"planRevision":2') && content.includes('"remainingModelRequests":2'));
          assert.ok(content.includes('"phase":"finishing"'));
        },
        events: [],
        error: new Error('PROVIDER_NETWORK_FAILED'),
      },
    ]);
    const context = new ContextService(
      new ConversationService(new SqliteConversationRepository(db), clock, null!, null!),
      new RecallService(new EmptyRecallRepository(), clock),
      new SkillRegistry(),
      emptyModelContinuations,
      null!,
    );
    const successful = await create(3, 40);
    for (const rejectionCode of ['TOOL_ARGUMENTS_INVALID', 'APP_CAPABILITY_DENIED', 'RESOURCE_FORBIDDEN']) {
      const rejected = await create(10, 40);
      const model = new ScriptedLanguageModel([
        {
          events: [
            { type: 'tool.delta', index: 0, id: 'rejected-call', name: 'scenario_read', argumentsDelta: '{}' },
            { type: 'completed', finishReason: 'tool-calls' },
          ],
        },
        {
          assertRequest: (request) => {
            const results = request.messages.filter((message) => message.role === 'tool');
            assert.equal(results.length, 1);
            assert.ok(results[0]!.content.includes(`\"errorCode\":\"${rejectionCode}\"`));
          },
          events: [
            { type: 'message.delta', text: 'Tool rejected; no execution claimed.' },
            { type: 'completed', finishReason: 'stop' },
          ],
        },
      ]);
      const calls = new ToolCallRunner(null!, null!, new PolicyService(), null!, null!);
      calls.schemas = () => [];
      calls.inspect = async () => {
        throw new Error(rejectionCode);
      };
      const execution = new NativeAgentBackend(
        runs,
        { listDelegations: async () => [] } as never,
        commit,
        new ModelStepRunner(
          new ProviderService(new StaticProviderRepository(benchmarkProvider), model, clock),
          context,
          model,
          new ScenarioModelCallLimiter(),
          clock,
        ),
        calls,
        clock,
      );
      for await (const _event of execution.execute(
        (await runs.snapshot(scope, rejected.run.id))!,
        new AbortController().signal,
      )) {
        /* Drain real durable proposal/rejection lifecycle. */
      }
      const settled = (await runs.snapshot(scope, rejected.run.id))!;
      assert.equal(settled.usage.toolExecutions, 0, 'rejected proposals never consume started-tool budget');
      assert.equal(settled.status, 'completed_unverified');
      const rows = await db.queryAll<{ inspection_json: string }>(
        'SELECT inspection_json FROM agent_tool_calls WHERE run_id = ?',
        [rejected.run.id],
      );
      assert.equal(rows.length, 1);
      assert.equal(JSON.parse(rows[0]!.inspection_json).rejectionCode, rejectionCode);
      model.assertConsumed();
    }
    let successfulRun = await compact(successful.run, successful.runtimeId);
    successfulRun = await observe(successfulRun, successful.runtimeId);
    const successfulModel = new ScriptedLanguageModel([
      {
        assertRequest: (request) => {
          assert.equal(request.toolMode, 'auto');
          assert.ok(request.messages.some((message) => message.content.includes('"extensionCount":1')));
        },
        events: [
          { type: 'message.delta', text: 'Service observation complete.' },
          { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 } },
          { type: 'completed', finishReason: 'stop' },
        ],
      },
    ]);
    const successfulRunner = new ModelStepRunner(
      new ProviderService(new StaticProviderRepository(benchmarkProvider), successfulModel, clock),
      context,
      successfulModel,
      new ScenarioModelCallLimiter(),
      clock,
    );
    const successfulBackend = new NativeAgentBackend(
      runs,
      { listDelegations: async () => [] } as never,
      commit,
      successfulRunner,
      { schemas: () => [] } as never,
      clock,
    );
    for await (const _event of successfulBackend.execute(
      (await runs.snapshot(scope, successfulRun.id))!,
      new AbortController().signal,
    )) {
      /* Drain. */
    }
    const successfulTerminal = (await runs.snapshot(scope, successfulRun.id))!;
    assert.equal(successfulTerminal.status, 'completed_unverified');
    assert.equal(successfulTerminal.budget.extensionCount, 1);
    assert.equal(successfulTerminal.budget.maxModelRequests, 5);
    successfulModel.assertConsumed();
    await db.execute('UPDATE agent_runs SET active_execution_seconds = 123 WHERE id = ?', [successfulTerminal.id]);
    const continuation = await create(5, 40, 100, successfulTerminal.id);
    assert.equal(continuation.run.usage.modelRequests, 3);
    assert.equal(continuation.run.usage.toolExecutions, 1);
    assert.equal(
      continuation.run.activeExecutionSeconds,
      123,
      'checkpoint continuation never resets cumulative resource consumption',
    );

    const providers = new ProviderService(new StaticProviderRepository(benchmarkProvider), scriptedModel, clock);
    const modelRunner = new ModelStepRunner(providers, context, scriptedModel, new ScenarioModelCallLimiter(), clock);
    modelRunner.waitBeforeRetry = async () => undefined;
    const backend = new NativeAgentBackend(
      runs,
      { listDelegations: async () => [] } as never,
      commit,
      modelRunner,
      { schemas: () => [] } as never,
      clock,
      async (current, reason) => {
        if (reason !== 'execution_limit') return;
        await checkpoints.save({
          scope,
          checkpointId: randomUUID(),
          kind: 'recovery',
          runId: current.id,
          expectedRunVersion: current.version,
          definitionVersion: '1.0.0',
          activeModel: current.definition.model,
          workspaceCaptures: [],
          backgroundJobs: [],
          now,
        });
      },
    );
    for await (const _event of backend.execute((await runs.snapshot(scope, run.id))!, new AbortController().signal)) {
      /* Drain real execution. */
    }
    const terminal = (await runs.snapshot(scope, run.id))!;
    assert.equal(terminal.status, 'interrupted');
    assert.equal(terminal.goalStatus, 'not_satisfied');
    assert.equal(terminal.verificationStatus, 'unverified');
    assert.ok(terminal.usage.modelRequests <= terminal.budget.modelRequestCeiling);
    const finals = await db.queryAll<{ payload_json: string }>(
      "SELECT payload_json FROM agent_events WHERE run_id = ? AND type = 'message.final'",
      [run.id],
    );
    assert.equal(finals.length, 1);
    assert.ok(
      finals[0]!.payload_json.includes('Verify deployment') && finals[0]!.payload_json.includes('Remaining work'),
    );
    assert.ok(
      (await checkpoints.list(scope, run.id)).length > 0,
      'partial execution retains a durable recovery checkpoint even if reporting fails',
    );
    const retained = (await runs.snapshot(scope, progressive.run.id))!;
    assert.equal(retained.budget.extensionCount, 1);
    assert.equal(retained.usage.modelRequests, 13);
    // Upgrade actual legacy durable records, then reopen again to verify reentrancy.
    const legacyBudget: Record<string, unknown> = { ...successfulTerminal.budget, maxRunSteps: 6 };
    for (const key of [
      'maxModelRequests',
      'modelRequestCeiling',
      'activeExecutionCeilingSeconds',
      'maxToolExecutions',
      'phase',
      'stopReason',
      'extensionCount',
      'progressSequence',
    ])
      delete legacyBudget[key];
    const legacyUsage: Record<string, unknown> = { ...successfulTerminal.usage, steps: 4 };
    delete legacyUsage.modelRequests;
    delete legacyUsage.toolExecutions;
    await db.execute('UPDATE agent_runs SET budget_json = ?, usage_json = ? WHERE id = ?', [
      JSON.stringify(legacyBudget),
      JSON.stringify(legacyUsage),
      successfulTerminal.id,
    ]);
    const defaults = createDefaultAgentSettings();
    const legacySettings = JSON.parse(JSON.stringify(defaults).replaceAll('maxModelRequests', 'maxRunSteps')) as {
      hardLimits: Record<string, unknown>;
    };
    delete legacySettings.hardLimits.maxToolExecutions;
    await db.execute('INSERT INTO agent_settings(user_id,value_json,revision,updated_at) VALUES(1,?,1,?)', [
      JSON.stringify(legacySettings),
      now,
    ]);
    await db.execute('DELETE FROM migrations WHERE id = 53');
    await db.close();
    for (let reopen = 0; reopen < 2; reopen++) {
      const upgradedDb = new DatabaseAdapter({ dataDirectory: directory, filename: 'budget.sqlite', nodeEnv: 'test' });
      try {
        await upgradedDb.initialize();
        const upgraded = (await new SqliteRunRepository(upgradedDb).snapshot(scope, successfulTerminal.id))!;
        assert.equal(upgraded.usage.modelRequests, 3, 'upgrade reconstructs actual attempts, not mixed legacy steps');
        assert.equal(upgraded.usage.toolExecutions, 1);
        assert.equal(upgraded.budget.modelRequestCeiling, 6);
        const settings = await upgradedDb.queryOne<{ value_json: string }>(
          'SELECT value_json FROM agent_settings WHERE user_id = 1',
        );
        assert.ok(settings?.value_json.includes('"maxModelRequests":80'));
        assert.ok(settings?.value_json.includes('"maxToolExecutions":4000'));
        assert.ok(!settings?.value_json.includes('maxRunSteps'));
      } finally {
        await upgradedDb.close();
      }
    }
    return [
      { name: 'automatic_budget_extensions', value: 1, unit: 'events' },
      { name: 'concurrent_request_overshoots', value: 0, unit: 'requests' },
      { name: 'partial_report_checkpoint', value: 1, unit: 'cases' },
    ];
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
