import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteConversationRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-conversation.repository';
import { SqliteModelContinuationRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-model-continuation.repository';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { decodeDurableJsonValue } from '../../../packages/backend/src/infrastructure/agent/runtime/durable-state-decoders';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import {
  decodeOpenAiResponsesContinuation,
  OpenAiResponsesContinuationCollector,
} from '../../../packages/backend/src/infrastructure/agent/providers/openai-provider-continuation';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ToolInspection, ToolResult } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import { decodeModelProviderContinuation } from '../../../packages/backend/src/modules/agent/ai/model-continuation';
import type {
  ModelProviderContinuation,
  ModelRequest,
} from '../../../packages/backend/src/modules/agent/ai/model.types';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import { SkillRegistry } from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { clock, SCENARIO_MODEL_CAPABILITIES, scope } from './scenario-fixtures';
import { EmptyRecallRepository } from './scenario-context-helpers';

export const providerContinuationRoundTripScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-provider-continuation-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'continuation.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const repository = new SqliteRunRepository(db);
  const now = 1_800_200_000;
  const runId = 'continuation-run';
  const runtimeId = 'continuation-runtime';
  const threadId = 'continuation-thread';
  const route = {
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
    protocol: 'responses' as const,
  };
  const modelRequest = (providerContinuation?: ModelProviderContinuation): ModelRequest => ({
    userId: 1,
    providerId: route.providerId,
    modelId: route.modelId,
    configurationVersion: route.configurationVersion,
    messages: [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'scenario_read', argumentsJson: '{}' }],
        ...(providerContinuation ? { providerContinuation } : {}),
      },
    ],
    maxOutputTokens: 256,
  });
  const makeContinuation = (suffix: string, toolCallId: string): ModelProviderContinuation => {
    const collector = new OpenAiResponsesContinuationCollector();
    collector.recordReasoning({
      openai: {
        itemId: `reasoning-${suffix}`,
        reasoningEncryptedContent: `encrypted-${suffix}`,
      },
    });
    collector.recordToolCall(toolCallId, { openai: { itemId: `item-${suffix}` } });
    const continuation = collector.build(route);
    assert.ok(continuation);
    return continuation;
  };
  const inspection = (toolName: string, operationHash: string): ToolInspection => ({
    toolName,
    toolVersion: '1',
    normalizedArguments: {},
    target: {
      kind: 'run',
      targetIdentity: runId,
      endpoint: runId,
      loginUser: runtimeId,
      configurationHash: 'continuation-fixture',
    },
    resourceKeys: [runId],
    risk: 'read',
    mutation: false,
    operationHash,
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: 1,
    inputRevision: 1,
  });
  const result = (summary: string): ToolResult => ({
    ok: true,
    summary,
    artifactRefs: [],
    truncated: false,
    outcome: 'confirmed',
    verification: { status: 'verified', summary: 'continuation fixture verified', evidenceRefs: [] },
  });

  try {
    const firstContinuation = makeContinuation('one', 'provider-call-1');
    assert.deepEqual(
      decodeOpenAiResponsesContinuation(firstContinuation, modelRequest(firstContinuation), 'responses'),
      [
        { type: 'reasoning', itemId: 'reasoning-one', reasoningEncryptedContent: 'encrypted-one' },
        { type: 'tool-call', toolCallId: 'provider-call-1', itemId: 'item-one' },
      ],
    );
    assert.deepEqual(
      decodeOpenAiResponsesContinuation(
        firstContinuation,
        { ...modelRequest(firstContinuation), configurationVersion: 2 },
        'responses',
      ),
      [],
      'opaque continuation must not cross provider configuration versions',
    );
    assert.deepEqual(
      decodeOpenAiResponsesContinuation(firstContinuation, modelRequest(firstContinuation), 'chat-completions'),
      [],
      'Responses continuation must not cross protocol boundaries',
    );
    const chatCollector = new OpenAiResponsesContinuationCollector();
    chatCollector.recordReasoning({
      openai: { itemId: 'chat-reasoning', reasoningEncryptedContent: 'chat-encrypted' },
    });
    assert.equal(
      chatCollector.build({ ...route, protocol: 'chat-completions' }),
      undefined,
      'Chat Completions must keep the simple path without fabricated continuation state',
    );
    assert.throws(
      () =>
        decodeModelProviderContinuation({
          ...firstContinuation,
          data: { payload: 'x'.repeat(300 * 1024) },
        }),
      /MODEL_PROVIDER_CONTINUATION_TOO_LARGE/,
      'opaque continuation envelopes must be size bounded before durability',
    );

    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'continuation-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads
        (id, user_id, app_id, title, title_source, next_sequence, created_at, updated_at)
       VALUES (?, 1, 'scenario-app', 'continuation', 'manual', 2, ?, ?)`,
      [threadId, now, now],
    );
    const budget = {
      maxRunSteps: 100,
      maxActiveExecutionSeconds: 3_600,
      toolTimeoutSeconds: 120,
      maxToolOutputBytes: 65_536,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      maxSubagentMessages: 100,
      maxSubagentMessageBytes: 1_048_576,
      contextPolicy: freezeRunContextPolicy('normal'),
      contextCompactionMode: 'balanced',
      revision: 1,
    };
    const definition = {
      schemaVersion: 1,
      agentDefinitionId: 'scenario-agent',
      requiredModelCapabilities: [],
      model: { providerId: route.providerId, modelId: route.modelId, configurationVersion: route.configurationVersion },
      modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
      rootModelRoutes: [],
      approvalMode: 'full_access',
      executionMode: 'execute',
      connectionIds: [],
      environment: null,
      policyRevision: 1,
      settingsRevision: 1,
    };
    const usage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      steps: 0,
      subagentMessages: 0,
      subagentMessageBytes: 0,
    };
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, goal_text, goal_revision, goal_updated_at,
         verification_status, budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         consumed_input_sequence, input_revision, created_at, started_at, updated_at)
       VALUES (?, 1, 'scenario-app', ?, 'running', 'in_progress', 'Use two read tools.', 1, ?,
               'not_started', ?, ?, ?, ?, 0, 0, 1, ?, ?, ?)`,
      [
        runId,
        threadId,
        now,
        JSON.stringify(budget),
        JSON.stringify(definition),
        JSON.stringify({ schemaVersion: 1, revision: 0, items: [] }),
        JSON.stringify(usage),
        now,
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'continuation-owner', ?, ?)`,
      [runtimeId, runId, JSON.stringify(definition.model), now, now],
    );
    await db.execute(
      `INSERT INTO ai_thread_entries
        (id, thread_id, user_id, app_id, run_id, sequence, kind, payload_json, created_at)
       VALUES ('continuation-input', ?, 1, 'scenario-app', ?, 1, 'user_input', ?, ?)`,
      [threadId, runId, JSON.stringify({ text: 'Use two read tools.', artifactRefs: [] }), now],
    );

    const runToolRound = async (
      round: number,
      continuation: ModelProviderContinuation,
      providerCallId: string,
    ): Promise<void> => {
      const before = await repository.snapshot(scope, runId);
      assert.ok(before);
      const begun = await stateCommit.beginModelStep({
        scope,
        runId,
        runtimeId,
        expectedRunVersion: before.version,
        inputWatermark: before.inputRevision,
        reservedTokens: 512,
        estimatedInputTokens: 128,
        reservedOutputTokens: 256,
        contextWindowTokens: 16_384,
        now: now + round * 10,
      });
      const proposed = await stateCommit.commitToolProposalBatch({
        scope,
        runId,
        runtimeId,
        modelStepId: begun.stepId,
        attemptId: begun.attemptId,
        expectedRunVersion: begun.run.version,
        assistantEntryId: `continuation-assistant-${round}`,
        assistantText: '',
        items: [
          {
            providerCallId,
            toolCallId: `continuation-tool-${round}`,
            toolName: 'scenario_read',
            toolVersion: '1',
            argumentsJson: '{}',
            inspection: inspection('scenario_read', `continuation-hash-${round}`),
          },
        ],
        usage: begun.run.usage,
        inputTokens: 100 + round,
        outputTokens: 20 + round,
        cachedInputTokens: 40,
        estimatedUsage: false,
        finishReason: 'tool-calls',
        providerContinuation: continuation,
        now: now + round * 10 + 1,
      });
      const item = proposed.items[0]!;
      const started = await stateCommit.beginReadToolBatch({
        scope,
        runId,
        runtimeId,
        expectedRunVersion: proposed.run.version,
        items: [{ toolStepId: item.toolStepId, toolCallId: item.toolCallId }],
        now: now + round * 10 + 2,
      });
      await stateCommit.settleReadToolBatch({
        scope,
        runId,
        runtimeId,
        expectedRunVersion: started.run.version,
        items: [
          {
            toolStepId: item.toolStepId,
            toolCallId: item.toolCallId,
            toolResultEntryId: `continuation-result-${round}`,
            providerCallId,
            result: result(`round ${round} result`),
          },
        ],
        now: now + round * 10 + 3,
      });
    };

    await runToolRound(1, firstContinuation, 'provider-call-1');
    const secondContinuation = makeContinuation('two', 'provider-call-2');
    await runToolRound(2, secondContinuation, 'provider-call-2');

    const rows = await db.queryAll<{ step_id: string; continuation_json: string | null }>(
      `SELECT step_id, continuation_json
       FROM agent_model_attempts
       WHERE continuation_json IS NOT NULL
       ORDER BY created_at, attempt_index`,
    );
    assert.equal(rows.length, 2, 'each completed Responses Tool round must durably own one continuation envelope');

    const freshContinuationRepository = new SqliteModelContinuationRepository(db);
    const modelStepRefs = await db.queryAll<{ id: string }>(
      `SELECT id FROM agent_steps WHERE run_id = ? AND kind = 'model' ORDER BY step_index`,
      [runId],
    );
    const loaded = await freshContinuationRepository.load(
      scope,
      modelStepRefs.map((row) => ({ runId, modelStepId: row.id })),
    );
    const loadedByStep = new Map(loaded.map((item) => [item.modelStepId, item.continuation] as const));
    assert.deepEqual(
      modelStepRefs.map((row) => loadedByStep.get(row.id)),
      [firstContinuation, secondContinuation],
      'restart projection must recover the exact opaque continuation envelopes',
    );

    const freshConversations = new ConversationService(new SqliteConversationRepository(db), clock, null!, null!);
    const freshContext = new ContextService(
      freshConversations,
      new RecallService(new EmptyRecallRepository(), clock),
      new SkillRegistry(),
      freshContinuationRepository,
      null!,
    );
    const contextPlan = await freshContext.compose({
      scope,
      threadId,
      runId,
      currentInput: 'Continue after both tool results.',
      modelContextWindow: 16_384,
      maxContextTokens: 16_384,
      reservedOutputTokens: 512,
      maxRecallItems: 1,
      maxRecallBytes: 1024,
      tools: [],
    });
    const assistantRounds = contextPlan.messages.filter(
      (message) => message.role === 'assistant' && message.toolCalls?.length,
    );
    assert.equal(assistantRounds.length, 2);
    assert.deepEqual(assistantRounds[0]?.providerContinuation, firstContinuation);
    assert.deepEqual(assistantRounds[1]?.providerContinuation, secondContinuation);
    assert.ok(
      contextPlan.estimatedInputTokens > 0 &&
        JSON.stringify(assistantRounds).includes('encrypted-one') &&
        JSON.stringify(assistantRounds).includes('encrypted-two'),
      'opaque continuation must participate in model-facing context reconstruction/accounting',
    );

    const durableAssistantPayloads = await db.queryAll<{ payload_json: string }>(
      `SELECT payload_json FROM ai_thread_entries
       WHERE run_id = ? AND kind = 'assistant_message' ORDER BY sequence`,
      [runId],
    );
    assert.equal(durableAssistantPayloads.length, 2);
    for (const payload of durableAssistantPayloads) {
      const parsed = decodeDurableJsonValue(JSON.parse(payload.payload_json));
      assert.ok(parsed && !Array.isArray(parsed) && typeof parsed === 'object');
      assert.equal(
        'providerContinuation' in parsed,
        false,
        'Ledger must hold only the model-step reference, not a second truth',
      );
      assert.equal(typeof parsed.modelStepId, 'string');
    }

    return [
      { name: 'responses_tool_rounds_with_continuation', value: rows.length, unit: 'rounds' },
      { name: 'restart_continuations_recovered', value: loaded.length, unit: 'rounds' },
      { name: 'cross_route_continuations_reused', value: 0, unit: 'rounds' },
      { name: 'chat_continuations_fabricated', value: 0, unit: 'rounds' },
      { name: 'ledger_duplicate_continuation_truths', value: 0, unit: 'copies' },
      { name: 'oversized_continuations_rejected', value: 1, unit: 'cases' },
    ];
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
