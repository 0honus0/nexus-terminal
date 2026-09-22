import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteConversationRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-conversation.repository';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { decodeOpenAiResponsesContinuation } from '../../../packages/backend/src/infrastructure/agent/providers/openai-provider-continuation';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import {
  resolveProviderModelConfig,
  snapshotProviderModelCapabilities,
} from '../../../packages/backend/src/modules/agent/ai/model-capability-resolver';
import type {
  ModelProviderContinuation,
  PersistedProviderView,
} from '../../../packages/backend/src/modules/agent/ai/model.types';
import { ProviderService } from '../../../packages/backend/src/modules/agent/ai/provider.service';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import { SkillRegistry } from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import type { BackendSignal } from '../../../packages/backend/src/modules/agent/runtime/execution/agent-backend.port';
import { ModelStepRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/model-step-runner';
import { NativeAgentBackend } from '../../../packages/backend/src/modules/agent/runtime/execution/native-agent-backend';
import { ToolCallRunner } from '../../../packages/backend/src/modules/agent/runtime/execution/tool-call-runner';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { runModelRoutes } from '../../../packages/backend/src/modules/agent/runtime/runs/model-routes';
import { clock, emptyModelContinuations, scope } from './scenario-fixtures';
import { EmptyRecallRepository } from './scenario-context-helpers';
import {
  ScenarioModelCallLimiter,
  ScriptedLanguageModel,
  StaticProviderCatalogRepository,
} from './scenario-benchmark-helpers';

export const providerFallbackChainScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-provider-fallback-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'provider-fallback.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const repository = new SqliteRunRepository(db);
  const conversationRepository = new SqliteConversationRepository(db);
  const now = 1_800_000_000;
  const runId = 'provider-fallback-run';
  const threadId = 'provider-fallback-thread';
  const runtimeId = 'provider-fallback-runtime';
  const primaryRef = { providerId: 'primary-provider', modelId: 'primary-model', configurationVersion: 3 };
  const fallbackRef = { providerId: 'fallback-provider', modelId: 'fallback-model', configurationVersion: 7 };

  const primaryPersisted: PersistedProviderView = {
    id: primaryRef.providerId,
    kind: 'openai-compatible',
    displayName: 'Primary provider',
    baseUrl: 'http://primary.invalid/v1',
    protocol: 'responses',
    hasCredential: false,
    credentialRevision: 0,
    models: [
      {
        id: primaryRef.modelId,
        capabilityOverrides: {
          contextWindow: 8_192,
          maxOutputTokens: 1_024,
          supportsTools: true,
          supportsImageInput: true,
          reasoning: { supportedEfforts: ['none', 'medium'], defaultEffort: 'medium' },
        },
      },
    ],
    liveCapabilities: [],
    enabled: true,
    version: primaryRef.configurationVersion,
    createdAt: now,
    updatedAt: now,
  };
  const fallbackPersisted: PersistedProviderView = {
    id: fallbackRef.providerId,
    kind: 'openai-compatible',
    displayName: 'Fallback provider',
    baseUrl: 'http://fallback.invalid/v1',
    protocol: 'responses',
    hasCredential: false,
    credentialRevision: 0,
    models: [
      {
        id: fallbackRef.modelId,
        capabilityOverrides: {
          contextWindow: 4_096,
          maxOutputTokens: 512,
          supportsTools: true,
          supportsImageInput: true,
          reasoning: { supportedEfforts: ['none', 'medium'], defaultEffort: 'medium' },
        },
      },
    ],
    liveCapabilities: [],
    enabled: true,
    version: fallbackRef.configurationVersion,
    createdAt: now,
    updatedAt: now,
  };
  const primaryCapabilities = snapshotProviderModelCapabilities(
    resolveProviderModelConfig(primaryPersisted.models[0]!),
  );
  const fallbackCapabilities = snapshotProviderModelCapabilities(
    resolveProviderModelConfig(fallbackPersisted.models[0]!),
  );
  const frozenFallbackRoute = { model: fallbackRef, modelCapabilities: fallbackCapabilities };

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'fallback-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads
        (id, user_id, app_id, title, title_source, next_sequence, created_at, updated_at)
       VALUES (?, 1, 'scenario-app', 'provider fallback', 'manual', 2, ?, ?)`,
      [threadId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, goal_text, goal_revision, goal_updated_at,
         verification_status, budget_json, definition_json, plan_json, usage_json,
         active_execution_started_at, executing_runtime_count, consumed_input_sequence, input_revision,
         created_at, started_at, updated_at)
       VALUES (?, 1, 'scenario-app', ?, 'running', 'in_progress', 'Finish through fallback.', 1, ?,
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
          requiredModelCapabilities: ['tools', 'image_input', 'reasoning'],
          model: primaryRef,
          modelCapabilities: primaryCapabilities,
          rootModelRoutes: [frozenFallbackRoute],
          reasoningEffort: 'medium',
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
       VALUES ('provider-fallback-input', ?, 1, 'scenario-app', ?, 1, 'user_input', ?, ?)`,
      [
        threadId,
        runId,
        JSON.stringify({ text: 'Use the configured fallback if the primary is unavailable.', artifactRefs: [] }),
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'owner-provider-fallback', ?, ?)`,
      [runtimeId, runId, JSON.stringify(primaryRef), now, now],
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
        events: [{ type: 'usage', usage: { inputTokens: 20, outputTokens: 1, cachedInputTokens: 0 } }],
        error: new Error('PROVIDER_HTTP_503'),
        assertRequest: (request) => assert.equal(request.providerId, primaryRef.providerId),
      },
      {
        events: [{ type: 'usage', usage: { inputTokens: 21, outputTokens: 1, cachedInputTokens: 0 } }],
        error: new Error('PROVIDER_HEADERS_TIMEOUT'),
        assertRequest: (request) => assert.equal(request.providerId, primaryRef.providerId),
      },
      {
        events: [
          { type: 'message.delta', text: 'stale-' },
          { type: 'tool.delta', index: 0, id: 'stale-tool', name: 'scenario_read', argumentsDelta: '{}' },
          { type: 'usage', usage: { inputTokens: 22, outputTokens: 2, cachedInputTokens: 0 } },
        ],
        error: new Error('PROVIDER_UNAVAILABLE'),
        assertRequest: (request) => assert.equal(request.providerId, primaryRef.providerId),
      },
      {
        events: [
          { type: 'message.delta', text: 'fallback-ok' },
          { type: 'usage', usage: { inputTokens: 18, outputTokens: 3, cachedInputTokens: 2 } },
          { type: 'completed', finishReason: 'stop' },
        ],
        assertRequest: (request) => {
          assert.equal(request.providerId, fallbackRef.providerId);
          assert.equal(request.modelId, fallbackRef.modelId);
          assert.equal(request.configurationVersion, fallbackRef.configurationVersion);
          assert.equal(request.capabilitySnapshot?.contextWindow, fallbackCapabilities.contextWindow);
        },
      },
    ]);
    const providers = new ProviderService(
      new StaticProviderCatalogRepository([primaryPersisted, fallbackPersisted]),
      scriptedModel,
      clock,
    );
    const modelRunner = new ModelStepRunner(providers, context, scriptedModel, new ScenarioModelCallLimiter());
    const snapshot = await repository.snapshot(scope, runId);
    assert.ok(snapshot, 'fallback fixture run must exist');
    assert.equal(
      snapshot.definition.rootModelRoutes?.length,
      1,
      'frozen fallback routes must survive durable definition decode',
    );
    assert.equal(
      snapshot.definition.rootModelRoutes?.[0]?.modelCapabilities?.contextWindow,
      fallbackCapabilities.contextWindow,
    );
    assert.deepEqual(
      runModelRoutes(snapshot.definition).map((route) => route.model),
      [primaryRef, fallbackRef],
      'effective frozen route chain must contain primary exactly once followed by configured fallbacks',
    );

    modelRunner.waitBeforeRetry = async () => undefined;
    const signal = new AbortController().signal;
    const recoverySafePoints: string[] = [];
    const backend = new NativeAgentBackend(
      repository,
      { listDelegations: async () => [] } as never,
      stateCommit,
      modelRunner,
      { schemas: () => [] } as unknown as ToolCallRunner,
      clock,
      async (_run, reason) => {
        recoverySafePoints.push(reason);
      },
    );
    const backendSignals: BackendSignal[] = [];
    for await (const backendSignal of backend.execute(snapshot, signal)) backendSignals.push(backendSignal);
    assert.deepEqual(
      recoverySafePoints,
      ['model_boundary'],
      'Native Root execution must await the rolling recovery checkpoint hook before a new model step',
    );

    const finalSnapshot = await repository.snapshot(scope, runId);
    assert.ok(finalSnapshot);
    assert.equal(finalSnapshot.status, 'completed_unverified');
    const durableRoute = await repository.rootRuntimeModel(scope, runId);
    assert.deepEqual(durableRoute, fallbackRef, 'runtime model_ref_json must be the restart-safe current route');

    const transientMessages = backendSignals.filter(
      (item): item is Extract<BackendSignal, { type: 'transient'; eventType: 'message.delta' }> =>
        item.type === 'transient' && item.eventType === 'message.delta',
    );
    const staleMessage = transientMessages.find((item) => item.payload.text === 'stale-');
    const fallbackMessage = transientMessages.find((item) => item.payload.text === 'fallback-ok');
    assert.ok(staleMessage && fallbackMessage);
    assert.notEqual(staleMessage.payload.attemptId, fallbackMessage.payload.attemptId);
    assert.notEqual(staleMessage.payload.attemptIndex, fallbackMessage.payload.attemptIndex);

    const routeEvents = await db.queryAll<{ payload_json: string }>(
      `SELECT payload_json FROM agent_events WHERE run_id = ? AND type = 'model.route_changed' ORDER BY sequence`,
      [runId],
    );
    assert.equal(routeEvents.length, 1, 'production execution must emit exactly one durable route change');
    const routePayload = JSON.parse(routeEvents[0]!.payload_json) as Record<string, unknown>;
    assert.deepEqual(routePayload.from, primaryRef);
    assert.deepEqual(routePayload.to, fallbackRef);
    assert.equal(routePayload.routeIndex, 1);
    assert.equal(routePayload.errorCode, 'PROVIDER_UNAVAILABLE');

    const attempts = await db.queryAll<{
      attempt_index: number;
      status: string;
      input_tokens: number | null;
      output_tokens: number | null;
      error_code: string | null;
    }>(
      `SELECT a.attempt_index, a.status, a.input_tokens, a.output_tokens, a.error_code
       FROM agent_model_attempts a
       JOIN agent_steps s ON s.id = a.step_id
       WHERE s.run_id = ? ORDER BY a.attempt_index`,
      [runId],
    );
    assert.deepEqual(
      attempts.map((attempt) => [attempt.attempt_index, attempt.status, attempt.input_tokens, attempt.output_tokens]),
      [
        [1, 'failed', 20, 1],
        [2, 'failed', 21, 1],
        [3, 'failed', 22, 2],
        [4, 'completed', 18, 3],
      ],
      'each route attempt must retain independent durable usage',
    );

    const fallbackRequest = scriptedModel.requests.at(-1)!;
    const primaryContinuation: ModelProviderContinuation = {
      schemaVersion: 1,
      providerId: primaryRef.providerId,
      modelId: primaryRef.modelId,
      configurationVersion: primaryRef.configurationVersion,
      protocol: 'responses',
      format: 'openai.responses.stateless.v1',
      data: { parts: [] },
    };
    assert.deepEqual(
      decodeOpenAiResponsesContinuation(primaryContinuation, fallbackRequest, 'responses'),
      [],
      'opaque provider continuation must fail closed across a route change',
    );
    scriptedModel.assertConsumed();

    return [
      { name: 'same_route_failed_attempts_before_fallback', value: 3, unit: 'attempts' },
      { name: 'durable_route_changes', value: 1, unit: 'events' },
      { name: 'authoritative_attempts', value: attempts.length, unit: 'attempts' },
      { name: 'fallback_route_index', value: 1, unit: 'index' },
      { name: 'cross_route_continuations_reused', value: 0, unit: 'continuations' },
      { name: 'native_recovery_model_safe_points', value: recoverySafePoints.length, unit: 'checkpoints' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
