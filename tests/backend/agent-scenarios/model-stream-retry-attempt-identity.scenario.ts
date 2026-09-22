import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteConversationRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-conversation.repository';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import { ProviderService } from '../../../packages/backend/src/modules/agent/ai/provider.service';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import { SkillRegistry } from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import type { BackendSignal } from '../../../packages/backend/src/modules/agent/runtime/execution/agent-backend.port';
import { ModelStepRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/model-step-runner';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { clock, emptyModelContinuations, SCENARIO_MODEL_CAPABILITIES, scope } from './scenario-fixtures';
import { EmptyRecallRepository } from './scenario-context-helpers';
import {
  benchmarkProvider,
  collectBackendSignals,
  ScenarioModelCallLimiter,
  ScriptedLanguageModel,
  StaticProviderRepository,
} from './scenario-benchmark-helpers';

export const modelStreamRetryAttemptIdentityScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-stream-retry-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'stream-retry.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const repository = new SqliteRunRepository(db);
  const conversationRepository = new SqliteConversationRepository(db);
  const now = 1_800_000_000;
  const runId = 'stream-retry-run';
  const threadId = 'stream-retry-thread';
  const runtimeId = 'stream-retry-runtime';

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'stream-retry-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads
        (id, user_id, app_id, title, title_source, next_sequence, created_at, updated_at)
       VALUES (?, 1, 'scenario-app', 'stream retry', 'manual', 2, ?, ?)`,
      [threadId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, goal_text, goal_revision, goal_updated_at,
         verification_status, budget_json, definition_json, plan_json, usage_json,
         active_execution_started_at, executing_runtime_count, consumed_input_sequence, input_revision,
         created_at, started_at, updated_at)
       VALUES (?, 1, 'scenario-app', ?, 'running', 'in_progress', 'Return a greeting.', 1, ?,
               'not_started', ?, ?, ?, ?, NULL, 0, 0, 1, ?, ?, ?)`,
      [
        runId,
        threadId,
        now,
        JSON.stringify({
          maxRunSteps: 20,
          maxActiveExecutionSeconds: 3_600,
          toolTimeoutSeconds: 120,
          maxToolOutputBytes: 1_048_576,
          maxRecallItems: 5,
          maxRecallBytes: 8_192,
          maxSubagentMessages: 100,
          maxSubagentMessageBytes: 1_048_576,
          contextPolicy: freezeRunContextPolicy('normal'),
          contextCompactionMode: 'balanced',
          revision: 1,
        }),
        JSON.stringify({
          schemaVersion: 1,
          agentDefinitionId: 'scenario-agent',
          requiredModelCapabilities: [],
          model: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
          modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
          rootModelRoutes: [],
          approvalMode: 'ask',
          executionMode: 'execute',
          connectionIds: [],
          environment: null,
          policyRevision: 1,
          settingsRevision: 1,
        }),
        JSON.stringify({ schemaVersion: 1, revision: 0, items: [] }),
        JSON.stringify({
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          steps: 0,
          subagentMessages: 0,
          subagentMessageBytes: 0,
        }),
        now,
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO ai_thread_entries
        (id, thread_id, user_id, app_id, run_id, sequence, kind, payload_json, created_at)
       VALUES ('stream-retry-input', ?, 1, 'scenario-app', ?, 1, 'user_input', ?, ?)`,
      [threadId, runId, JSON.stringify({ text: 'Say hello world.', artifactRefs: [] }), now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'owner-stream-retry', ?, ?)`,
      [
        runtimeId,
        runId,
        JSON.stringify({ providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 }),
        now,
        now,
      ],
    );

    const conversations = new ConversationService(conversationRepository, clock, null!, null!);
    const context = new ContextService(
      conversations,
      new RecallService(new EmptyRecallRepository(), clock),
      new SkillRegistry(),
      emptyModelContinuations,
      null!,
    );
    const scriptedModel = new ScriptedLanguageModel([
      {
        events: [
          { type: 'message.delta', text: 'hel' },
          { type: 'tool.delta', index: 0, id: 'failed-call', name: 'scenario_read' },
          { type: 'tool.delta', index: 0, argumentsDelta: '{"path":"' },
          { type: 'usage', usage: { inputTokens: 40, outputTokens: 3, cachedInputTokens: 4 } },
        ],
        error: new Error('PROVIDER_STREAM_TRUNCATED'),
      },
      {
        events: [
          { type: 'message.delta', text: 'hello ' },
          { type: 'message.delta', text: 'world' },
          { type: 'usage', usage: { inputTokens: 41, outputTokens: 5, cachedInputTokens: 4 } },
          { type: 'completed', finishReason: 'stop' },
        ],
      },
    ]);
    const providers = new ProviderService(new StaticProviderRepository(benchmarkProvider), scriptedModel, clock);
    const modelRunner = new ModelStepRunner(providers, context, scriptedModel, new ScenarioModelCallLimiter());
    const snapshot = await repository.snapshot(scope, runId);
    assert.ok(snapshot, 'stream retry fixture run must exist');
    const prepared = await modelRunner.prepare(snapshot, scope, [], {});
    const reservedTokens = prepared.contextPlan.estimatedInputTokens + prepared.contextPlan.reservedOutputTokens;
    const begun = await stateCommit.beginModelStep({
      scope,
      runId,
      runtimeId,
      expectedRunVersion: snapshot.version,
      inputWatermark: snapshot.inputRevision,
      reservedTokens,
      estimatedInputTokens: prepared.contextPlan.estimatedInputTokens,
      reservedOutputTokens: prepared.contextPlan.reservedOutputTokens,
      contextWindowTokens: prepared.model.contextWindow,
      now,
    });

    const signal = new AbortController().signal;
    const first = await collectBackendSignals(
      modelRunner.runAttempt(
        snapshot,
        prepared.contextPlan,
        { attemptId: begun.attemptId, attemptIndex: begun.attemptIndex },
        signal,
      ),
    );
    assert.equal((first.result.error as Error | undefined)?.message, 'PROVIDER_STREAM_TRUNCATED');
    assert.equal(modelRunner.shouldRetry(first.result.error, begun.attemptIndex, signal), true);
    assert.ok(first.result.usage, 'failed streamed attempt must retain provider usage');

    const firstMessageSignals = first.signals.filter(
      (item): item is Extract<BackendSignal, { type: 'transient'; eventType: 'message.delta' }> =>
        item.type === 'transient' && item.eventType === 'message.delta',
    );
    const firstToolSignals = first.signals.filter(
      (item): item is Extract<BackendSignal, { type: 'transient'; eventType: 'tool.delta' }> =>
        item.type === 'transient' && item.eventType === 'tool.delta',
    );
    assert.equal(firstMessageSignals.length, 1);
    assert.ok(firstToolSignals.length >= 1);
    for (const transient of [...firstMessageSignals, ...firstToolSignals]) {
      assert.equal(transient.payload.attemptId, begun.attemptId);
      assert.equal(transient.payload.attemptIndex, begun.attemptIndex);
    }

    const failedUsage = first.result.usage!;
    const usageAfterFailed = {
      ...begun.run.usage,
      inputTokens: begun.run.usage.inputTokens + failedUsage.inputTokens,
      outputTokens: begun.run.usage.outputTokens + failedUsage.outputTokens,
      cachedInputTokens: begun.run.usage.cachedInputTokens + failedUsage.cachedInputTokens,
    };
    const retried = await stateCommit.retryModelStep({
      scope,
      runId,
      runtimeId,
      stepId: begun.stepId,
      attemptId: begun.attemptId,
      expectedRunVersion: begun.run.version,
      reservedTokens,
      usage: usageAfterFailed,
      inputTokens: failedUsage.inputTokens,
      outputTokens: failedUsage.outputTokens,
      cachedInputTokens: failedUsage.cachedInputTokens,
      estimatedUsage: false,
      errorCode: 'PROVIDER_STREAM_TRUNCATED',
      now: now + 1,
    });
    assert.notEqual(retried.attemptId, begun.attemptId);
    assert.equal(retried.attemptIndex, begun.attemptIndex + 1);
    const retryEvent = retried.committedEvents.find((event) => event.type === 'model.retrying');
    assert.ok(retryEvent, 'retry must durably announce the new authoritative attempt');
    assert.deepEqual(retryEvent.payload, {
      stepId: begun.stepId,
      previousAttemptId: begun.attemptId,
      attemptId: retried.attemptId,
      attemptIndex: retried.attemptIndex,
      errorCode: 'PROVIDER_STREAM_TRUNCATED',
    });

    const second = await collectBackendSignals(
      modelRunner.runAttempt(
        snapshot,
        prepared.contextPlan,
        { attemptId: retried.attemptId, attemptIndex: retried.attemptIndex },
        signal,
      ),
    );
    assert.equal(second.result.error, undefined);
    assert.equal(second.result.finishReason, 'stop');
    assert.equal(second.result.text, 'hello world');
    assert.ok(second.result.usage, 'successful retry must retain provider usage');
    const secondMessageSignals = second.signals.filter(
      (item): item is Extract<BackendSignal, { type: 'transient'; eventType: 'message.delta' }> =>
        item.type === 'transient' && item.eventType === 'message.delta',
    );
    assert.equal(secondMessageSignals.length, 2, 'same attempt must be allowed to append multiple deltas');
    for (const transient of secondMessageSignals) {
      assert.equal(transient.payload.attemptId, retried.attemptId);
      assert.equal(transient.payload.attemptIndex, retried.attemptIndex);
    }

    interface PresentationState {
      attemptId: string | null;
      attemptIndex: number | null;
      text: string;
    }
    const emptyPresentation = (): PresentationState => ({ attemptId: null, attemptIndex: null, text: '' });
    const applyTransient = (state: PresentationState, transient: BackendSignal): void => {
      if (transient.type !== 'transient' || transient.payload.delegationId) return;
      if (state.attemptId !== transient.payload.attemptId || state.attemptIndex !== transient.payload.attemptIndex) {
        state.attemptId = transient.payload.attemptId;
        state.attemptIndex = transient.payload.attemptIndex;
        state.text = '';
      }
      if (transient.eventType === 'message.delta') state.text += transient.payload.text;
    };
    const applyRetry = (state: PresentationState): void => {
      if (state.attemptId !== begun.attemptId) return;
      state.attemptId = retried.attemptId;
      state.attemptIndex = retried.attemptIndex;
      state.text = '';
    };

    const orderedPresentation = emptyPresentation();
    applyTransient(orderedPresentation, firstMessageSignals[0]!);
    assert.equal(orderedPresentation.text, 'hel');
    applyRetry(orderedPresentation);
    for (const transient of secondMessageSignals) applyTransient(orderedPresentation, transient);
    assert.equal(orderedPresentation.text, 'hello world');

    const racedPresentation = emptyPresentation();
    applyTransient(racedPresentation, firstMessageSignals[0]!);
    applyTransient(racedPresentation, secondMessageSignals[0]!);
    applyRetry(racedPresentation);
    applyTransient(racedPresentation, secondMessageSignals[1]!);
    assert.equal(
      racedPresentation.text,
      'hello world',
      'late durable retry delivery must not erase or concatenate a newer attempt',
    );

    const disconnectedPresentation = emptyPresentation();
    applyTransient(disconnectedPresentation, firstMessageSignals[0]!);
    Object.assign(disconnectedPresentation, emptyPresentation());
    assert.equal(disconnectedPresentation.text, '');
    assert.equal(disconnectedPresentation.attemptId, null);

    const successfulUsage = second.result.usage!;
    const usageAfterSuccess = {
      ...retried.run.usage,
      inputTokens: retried.run.usage.inputTokens + successfulUsage.inputTokens,
      outputTokens: retried.run.usage.outputTokens + successfulUsage.outputTokens,
      cachedInputTokens: retried.run.usage.cachedInputTokens + successfulUsage.cachedInputTokens,
      steps: retried.run.usage.steps + 1,
    };
    const settled = await stateCommit.settleModelStep({
      scope,
      runId,
      runtimeId,
      stepId: begun.stepId,
      attemptId: retried.attemptId,
      expectedRunVersion: retried.run.version,
      assistantEntryId: 'stream-retry-final',
      assistantText: second.result.text,
      usage: usageAfterSuccess,
      inputTokens: successfulUsage.inputTokens,
      outputTokens: successfulUsage.outputTokens,
      cachedInputTokens: successfulUsage.cachedInputTokens,
      estimatedUsage: false,
      finishReason: 'stop',
      terminalStatus: 'completed_unverified',
      now: now + 2,
    });
    assert.equal(settled.run.status, 'completed_unverified');

    const failedAttempt = await db.queryOne<{
      status: string;
      attempt_index: number;
      input_tokens: number | null;
      output_tokens: number | null;
      error_code: string | null;
    }>(
      `SELECT status, attempt_index, input_tokens, output_tokens, error_code
       FROM agent_model_attempts WHERE id = ?`,
      [begun.attemptId],
    );
    const successfulAttempt = await db.queryOne<{
      status: string;
      attempt_index: number;
      input_tokens: number | null;
      output_tokens: number | null;
      error_code: string | null;
    }>(
      `SELECT status, attempt_index, input_tokens, output_tokens, error_code
       FROM agent_model_attempts WHERE id = ?`,
      [retried.attemptId],
    );
    assert.deepEqual(failedAttempt, {
      status: 'failed',
      attempt_index: 1,
      input_tokens: 40,
      output_tokens: 3,
      error_code: 'PROVIDER_STREAM_TRUNCATED',
    });
    assert.deepEqual(successfulAttempt, {
      status: 'completed',
      attempt_index: 2,
      input_tokens: 41,
      output_tokens: 5,
      error_code: null,
    });

    const ledger = await conversationRepository.readEntries(scope, threadId, 20);
    const assistantEntries = ledger.items.filter((entry) => entry.kind === 'assistant_message');
    assert.equal(assistantEntries.length, 1);
    const assistantPayload = assistantEntries[0]?.payload;
    assert.ok(assistantPayload && typeof assistantPayload === 'object' && !Array.isArray(assistantPayload));
    assert.equal((assistantPayload as Record<string, unknown>).text, 'hello world');
    assert.equal(JSON.stringify(assistantPayload).includes('helhello'), false);

    const transientDurableCount = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM agent_events
       WHERE run_id = ? AND type IN ('message.delta', 'tool.delta')`,
      [runId],
    );
    assert.equal(transientDurableCount?.count, 0, 'ephemeral deltas must never become durable run events');
    const finalSnapshot = await repository.snapshot(scope, runId);
    assert.ok(finalSnapshot);
    assert.equal(finalSnapshot.usage.inputTokens, 81);
    assert.equal(finalSnapshot.usage.outputTokens, 8);
    assert.equal(finalSnapshot.usage.cachedInputTokens, 8);
    scriptedModel.assertConsumed();

    return [
      { name: 'authoritative_attempts', value: 2, unit: 'attempts' },
      { name: 'failed_attempt_partial_prefix_bytes', value: Buffer.byteLength('hel'), unit: 'bytes' },
      { name: 'successful_attempt_message_deltas', value: secondMessageSignals.length, unit: 'events' },
      { name: 'tool_deltas_with_attempt_identity', value: firstToolSignals.length, unit: 'events' },
      { name: 'durable_transient_delta_rows', value: transientDurableCount?.count ?? -1, unit: 'rows' },
      { name: 'final_assistant_messages', value: assistantEntries.length, unit: 'messages' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
