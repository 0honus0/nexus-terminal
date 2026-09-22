import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteSubagentRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-subagent.repository';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ClockPort, JsonValue, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import { SubagentContextBuilder } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-context-builder';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import type { RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { emptyModelContinuations, scenarioDelegationModel, SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const subagentMailboxTtlScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-mailbox-ttl-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'mailbox-ttl.sqlite', nodeEnv: 'test' });
  const repository = new SqliteSubagentRepository(db);
  const now = 1_800_550_000;
  const scenarioScope: Scope = { userId: 1, appId: 'mailbox-ttl-app' };
  const runId = 'mailbox-ttl-run';
  const rootRuntimeId = 'mailbox-ttl-root';
  const childRuntimeId = 'mailbox-ttl-child';
  const delegationId = 'mailbox-ttl-delegation';
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });
  const budget = JSON.stringify({
    maxRunSteps: 100,
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
  });
  const definition = JSON.stringify({
    schemaVersion: 1,
    agentDefinitionId: 'scenario-agent',
    requiredModelCapabilities: [],
    model: JSON.parse(modelRef),
    modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
    rootModelRoutes: [],
    approvalMode: 'ask',
    executionMode: 'execute',
    connectionIds: [],
    environment: null,
    policyRevision: 1,
    settingsRevision: 1,
  });
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });

  const send = async (id: string, body: JsonValue, sentAt: number, expiresAt: number) =>
    repository.sendMessage({
      scope: scenarioScope,
      id,
      runId,
      senderRuntimeId: rootRuntimeId,
      recipientRuntimeId: childRuntimeId,
      delegationId,
      kind: 'request',
      idempotencyKey: `key-${id}`,
      payloadHash: `hash-${id}`,
      correlationId: `corr-${id}`,
      replyTo: null,
      causationId: null,
      taskRevision: 1,
      body,
      artifactRefs: [],
      sizeBytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
      expiresAt,
      now: sentAt,
      maxPending: 100,
      maxHardRunMessages: 1000,
      maxHardRunBytes: 1_048_576,
    });

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'mailbox-ttl-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('mailbox-ttl-thread', 1, ?, 'mailbox ttl', 'manual', ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, 'mailbox-ttl-thread', 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 0, ?, ?, ?)`,
      [runId, scenarioScope.appId, budget, definition, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES
         (?, ?, 'root', 'native', ?, 'running', 'runnable', 0, 'owner-mailbox-root', ?, ?),
         (?, ?, 'child:mailbox-ttl-delegation', 'native', ?, 'running', 'runnable', 0, 'owner-mailbox-child', ?, ?)`,
      [rootRuntimeId, runId, modelRef, now, now, childRuntimeId, runId, modelRef, now, now],
    );
    await db.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, grants_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'default', '[]', 'parent-child', ?, 'Process mailbox messages.', '[]', '[]', '[]',
               'settled', 'running', 1, 'isolate', 20, 'mailbox-ttl-delegation-key', 'mailbox-ttl-delegation-hash',
               ?, 1, ?, ?)`,
      [delegationId, runId, rootRuntimeId, childRuntimeId, scenarioDelegationModel(modelRef), now + 600, now, now],
    );

    const expired = await send('mailbox-ttl-expired', { text: 'expired-body' }, now, now + 2);
    const live = await send('mailbox-ttl-live', { text: 'live-body' }, now, now + 100);
    assert.equal(expired.recipientSequence, 1);
    assert.equal(live.recipientSequence, 2);

    const wake = await db.queryOne<{ id: string; deadline_at: number }>(
      `SELECT id, deadline_at FROM agent_scheduler_work
       WHERE run_id = ? AND agent_runtime_id = ? AND kind = 'consume_inbox' AND status = 'queued'`,
      [runId, childRuntimeId],
    );
    assert.ok(wake);
    assert.equal(wake.deadline_at, now + 100, 'queued inbox wake must track the latest live message TTL');

    const delegation = await repository.delegation(scenarioScope, runId, delegationId);
    assert.ok(delegation);
    const contextBuilder = new SubagentContextBuilder(
      repository,
      repository,
      { discover: () => [] } as unknown as ToolCatalog,
      new CapabilityRegistry(),
      emptyModelContinuations,
      null!,
      { nowUnixSeconds: () => now + 3 } as ClockPort,
    );
    const context = await contextBuilder.prepare(
      scenarioScope,
      runId,
      childRuntimeId,
      delegation,
      {
        id: 'scenario-model',
        contextWindow: 16_384,
        maxOutputTokens: 2_048,
        supportsTools: true,
        supportsImageInput: false,
        supportsFileInput: false,
      } as Parameters<SubagentContextBuilder['prepare']>[4],
      {
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          steps: 0,
          subagentMessages: 2,
          subagentMessageBytes: 64,
        },
        budget: { maxRunSteps: 100, maxToolOutputBytes: 1_048_576, contextPolicy: freezeRunContextPolicy('normal') },
        definition: { environment: null },
      } as unknown as RunView,
    );
    assert.equal(context.kind, 'ready');
    if (context.kind !== 'ready') throw new Error('SCENARIO_INVALID');
    assert.deepEqual(
      context.plan.inbox.map((message) => ({ sequence: message.recipientSequence, status: message.status })),
      [{ sequence: 2, status: 'delivered' }],
      'runtime inbox projection must exclude expired rows',
    );
    const modelContext = context.plan.messages.map((message) => message.content).join('\n');
    assert.equal(modelContext.includes('expired-body'), false, 'expired mailbox body must not reach Child context');
    assert.equal(modelContext.includes('live-body'), true, 'unexpired mailbox body must remain visible');

    const consumed = await repository.consumeMessages(scenarioScope, runId, childRuntimeId, 2, 0, now + 3);
    assert.equal(consumed, 2, 'watermark must cross an expired sequence using durable continuity');
    const rows = await db.queryAll<{ id: string; status: string }>(
      'SELECT id, status FROM agent_messages WHERE run_id = ? ORDER BY recipient_sequence',
      [runId],
    );
    assert.deepEqual(rows, [
      { id: 'mailbox-ttl-expired', status: 'expired' },
      { id: 'mailbox-ttl-live', status: 'consumed' },
    ]);
    assert.equal(
      (
        await db.queryOne<{ consumed_mailbox_sequence: number }>(
          'SELECT consumed_mailbox_sequence FROM agent_runtimes WHERE id = ?',
          [childRuntimeId],
        )
      )?.consumed_mailbox_sequence,
      2,
    );
    const history = await repository.listDelegationMessages(scenarioScope, runId, delegationId, 16);
    assert.equal(history.length, 2, 'expired rows must remain in durable mailbox history');
    assert.equal(
      history.some((message) => message.status === 'expired' && JSON.stringify(message.body).includes('expired-body')),
      true,
    );

    const readyWake = (await repository.readyWork(now + 3, 16)).find((work) => work.id === wake.id);
    assert.ok(readyWake);
    const claimedWake = await repository.claimWork(readyWake.id, readyWake.version, 701, now + 3);
    assert.ok(claimedWake);
    await repository.settleWork(claimedWake.id, 701, 'completed', now + 3);

    const restartExpired = await send(
      'mailbox-ttl-restart-expired',
      { text: 'restart-expired-body' },
      now + 4,
      now + 5,
    );
    assert.equal(restartExpired.recipientSequence, 3);
    const restartedRepository = new SqliteSubagentRepository(db);
    const restartProjection = await restartedRepository.readMessages(
      scenarioScope,
      runId,
      childRuntimeId,
      2,
      8,
      now + 6,
    );
    assert.deepEqual(restartProjection, [], 'restart/lazy read must not revive an already expired message');
    assert.equal(
      (
        await db.queryOne<{ status: string }>('SELECT status FROM agent_messages WHERE id = ?', [
          restartExpired.messageId,
        ])
      )?.status,
      'expired',
    );
    const terminalWake = (await restartedRepository.terminalWork(now + 6, 16)).find(
      (work) => work.kind === 'consume_inbox' && work.agentRuntimeId === childRuntimeId,
    );
    assert.ok(terminalWake, 'expired consume_inbox wake must be discoverable for terminal cleanup');
    const terminalClaim = await restartedRepository.claimWork(terminalWake.id, terminalWake.version, 702, now + 6);
    assert.ok(terminalClaim);
    await restartedRepository.settleWork(terminalClaim.id, 702, 'cancelled', now + 6);
    assert.equal(
      (await db.queryOne<{ status: string }>('SELECT status FROM agent_scheduler_work WHERE id = ?', [terminalWake.id]))
        ?.status,
      'cancelled',
    );

    const directExpired = await send('mailbox-ttl-direct-expired', { text: 'direct-expired-body' }, now + 7, now + 8);
    const directLive = await send('mailbox-ttl-direct-live', { text: 'direct-live-body' }, now + 7, now + 30);
    assert.equal(directExpired.recipientSequence, 4);
    assert.equal(directLive.recipientSequence, 5);
    const crossed = await restartedRepository.consumeMessages(scenarioScope, runId, childRuntimeId, 5, 2, now + 9);
    assert.equal(crossed, 5, 'consume must expire time-stale rows before advancing across them');
    assert.deepEqual(
      await db.queryAll<{ id: string; status: string }>(
        'SELECT id, status FROM agent_messages WHERE recipient_sequence >= 3 ORDER BY recipient_sequence',
      ),
      [
        { id: 'mailbox-ttl-restart-expired', status: 'expired' },
        { id: 'mailbox-ttl-direct-expired', status: 'expired' },
        { id: 'mailbox-ttl-direct-live', status: 'consumed' },
      ],
      'consume must preserve expired status even when lazy read did not touch the row first',
    );

    return [
      { name: 'expired_context_messages', value: 0, unit: 'messages' },
      { name: 'mailbox_consumed_watermark', value: crossed, unit: 'sequence' },
      {
        name: 'expired_history_rows',
        value: history.filter((message) => message.status === 'expired').length,
        unit: 'messages',
      },
      { name: 'terminal_inbox_wakes', value: 1, unit: 'work-items' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
