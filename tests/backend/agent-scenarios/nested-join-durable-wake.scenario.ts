import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteSubagentRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-subagent.repository';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { SubagentParticipantExecutor } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-participant-executor';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { scenarioDelegationModel, SCENARIO_MODEL_CAPABILITIES } from './scenario-fixtures';

export const nestedJoinDurableWakeScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-join-resume-scenario-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'join-resume.sqlite', nodeEnv: 'test' });
  const repository = new SqliteSubagentRepository(db);
  const now = 1_800_500_000;
  const scenarioScope: Scope = { userId: 1, appId: 'join-resume-app' };
  const runId = 'join-resume-run';
  const parentRuntimeId = 'join-parent-runtime';
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
  const childA = { runtimeId: 'join-child-a-runtime', delegationId: 'join-child-a' };
  const childB = { runtimeId: 'join-child-b-runtime', delegationId: 'join-child-b' };
  const joinToolCallId = 'join-control-tool-call';
  const hostRootEnqueues: string[] = [];
  const participant = new SubagentParticipantExecutor(
    repository,
    repository,
    null!,
    null!,
    null!,
    {
      enqueueRootRun: async (id) => {
        hostRootEnqueues.push(id);
      },
      wakeChildScheduler: () => undefined,
      cancelChildRuntime: () => undefined,
    },
    { nowUnixSeconds: () => now } as ClockPort,
  );

  const insertDelegation = async (
    id: string,
    parentId: string,
    runtimeId: string,
    objective: string,
  ): Promise<void> => {
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, ?, 'native', ?, 'running', 'runnable', 0, ?, ?, ?)`,
      [runtimeId, runId, `child:${id}`, modelRef, `owner-${runtimeId}`, now, now],
    );
    await db.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, grants_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'default', '[]', 'parent-child', ?, ?, '[]', '[]', '[]', 'settled', 'running',
               2, 'isolate', 10, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        runId,
        parentId,
        runtimeId,
        scenarioDelegationModel(modelRef),
        objective,
        `key-${id}`,
        `hash-${id}`,
        now + 600,
        now,
        now,
      ],
    );
  };

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'join-resume-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('join-resume-thread', 1, ?, 'join resume', 'manual', ?, ?)`,
      [scenarioScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, 'join-resume-thread', 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 0, ?, ?, ?)`,
      [runId, scenarioScope.appId, budget, definition, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES ('join-root-runtime', ?, 'root', 'native', ?, 'running', 'runnable', 0, 'owner-join-root', ?, ?)`,
      [runId, modelRef, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'child:parent', 'native', ?, 'running', 'joining', 0, 'owner-join-parent', ?, ?)`,
      [parentRuntimeId, runId, modelRef, now, now],
    );
    await db.execute(
      `INSERT INTO agent_delegations
        (id, run_id, parent_runtime_id, child_runtime_id, profile_id, grants_json, peer_messaging,
         model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
         dependency_mode, status, depth, failure_mode, max_steps, idempotency_key, request_hash,
         deadline_at, version, created_at, updated_at)
       VALUES ('join-parent-delegation', ?, 'join-root-runtime', ?, 'default', '[]', 'parent-child', ?,
               'nested parent', '[]', '[]', '[]', 'settled', 'running', 1, 'isolate', 20,
               'join-parent-key', 'join-parent-hash', ?, 1, ?, ?)`,
      [runId, parentRuntimeId, scenarioDelegationModel(modelRef), now + 900, now, now],
    );
    await insertDelegation(childA.delegationId, parentRuntimeId, childA.runtimeId, 'child A');
    await insertDelegation(childB.delegationId, parentRuntimeId, childB.runtimeId, 'child B');

    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES
         ('join-control-model-step', ?, ?, 1, 'model', 'completed', 0, '[]', '[]', ?, ?),
         ('join-control-step', ?, ?, 2, 'tool', 'completed', 0, '[]', '[]', ?, ?)`,
      [runId, parentRuntimeId, now, now, runId, parentRuntimeId, now, now],
    );
    const joinInspection = {
      toolName: 'join_subagents',
      toolVersion: '1',
      normalizedArguments: {
        delegationIds: [childA.delegationId, childB.delegationId],
        mode: 'all',
        deadlineAt: now + 300,
      },
      target: {
        kind: 'run',
        targetIdentity: `run:${runId}`,
        endpoint: `run:${runId}`,
        loginUser: `agent-runtime:${parentRuntimeId}`,
        configurationHash: 'join-control-hash',
      },
      resourceKeys: [],
      risk: 'control',
      mutation: false,
      operationHash: 'join-control-hash',
      operationHashVersion: 1,
      preconditions: [],
      policyRevision: 1,
      inputRevision: 0,
    };
    const waitingResult = {
      ok: true,
      summary: 'Subagent join is waiting for child progress.',
      data: { ready: false, settled: [], running: [childA.delegationId, childB.delegationId], timedOut: false },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: { status: 'verified', summary: 'join inspected', evidenceRefs: [] },
    };
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
         created_at, started_at, completed_at)
       VALUES (?, ?, ?, 'join-control-step', 'join-control-model-step', 0, 1,
               'provider-join-control', 'join_subagents', '1', ?,
               'join-control-hash', 1, 'control', 'succeeded', ?, ?, ?, ?)`,
      [
        joinToolCallId,
        runId,
        parentRuntimeId,
        JSON.stringify(joinInspection),
        JSON.stringify(waitingResult),
        now,
        now,
        now,
      ],
    );

    // Completion mailbox is intentionally omitted here: durable control wake must be sufficient by itself.
    await repository.cancelDelegation(scenarioScope, runId, childA.delegationId, 1, now + 1);
    let resumeRows = await db.queryAll<{ id: string; status: string; version: number }>(
      `SELECT id, status, version FROM agent_scheduler_work WHERE run_id = ? AND kind = 'join_resume'`,
      [runId],
    );
    assert.deepEqual(
      resumeRows.map((row) => row.id),
      [`join-resume:${joinToolCallId}`],
    );
    assert.equal(resumeRows[0]?.status, 'queued');

    const firstReady = (await repository.readyWork(now + 1, 16)).find((work) => work.kind === 'join_resume');
    assert.ok(firstReady, 'first child terminal must create claimable join_resume work');
    const firstClaim = await repository.claimWork(firstReady.id, firstReady.version, 111, now + 1);
    assert.ok(firstClaim);
    assert.equal(await repository.resetClaimedWork(222, now + 2), 1);
    assert.equal(
      (
        await db.queryOne<{ schedule_state: string }>('SELECT schedule_state FROM agent_runtimes WHERE id = ?', [
          parentRuntimeId,
        ])
      )?.schedule_state,
      'joining',
      'scheduler epoch recovery must not bypass join re-check',
    );
    const recoveredReady = (await repository.readyWork(now + 2, 16)).find((work) => work.kind === 'join_resume');
    assert.ok(recoveredReady);
    const recoveredClaim = await repository.claimWork(recoveredReady.id, recoveredReady.version, 222, now + 2);
    assert.ok(recoveredClaim);
    await participant.handleJoinResume(scenarioScope, recoveredClaim, 222);
    assert.equal(
      (
        await db.queryOne<{ schedule_state: string }>('SELECT schedule_state FROM agent_runtimes WHERE id = ?', [
          parentRuntimeId,
        ])
      )?.schedule_state,
      'joining',
      'mode=all must stay joining while another child is still running',
    );

    await repository.cancelDelegation(scenarioScope, runId, childB.delegationId, 1, now + 3);
    resumeRows = await db.queryAll<{ id: string; status: string; version: number }>(
      `SELECT id, status, version FROM agent_scheduler_work WHERE run_id = ? AND kind = 'join_resume'`,
      [runId],
    );
    assert.equal(resumeRows.length, 1, 'multiple child completions must merge into one join_resume lineage');
    assert.equal(resumeRows[0]?.status, 'queued');
    const finalReady = (await repository.readyWork(now + 3, 16)).find((work) => work.kind === 'join_resume');
    assert.ok(finalReady);
    const finalClaim = await repository.claimWork(finalReady.id, finalReady.version, 333, now + 3);
    assert.ok(finalClaim);
    await participant.handleJoinResume(scenarioScope, finalClaim, 333);
    assert.equal(
      (
        await db.queryOne<{ schedule_state: string }>('SELECT schedule_state FROM agent_runtimes WHERE id = ?', [
          parentRuntimeId,
        ])
      )?.schedule_state,
      'runnable',
    );
    const modelResume = await db.queryAll<{ id: string; status: string; payload_json: string }>(
      `SELECT id, status, payload_json FROM agent_scheduler_work
       WHERE run_id = ? AND agent_runtime_id = ? AND kind = 'model_step' AND id LIKE 'model-resume:%'`,
      [runId, parentRuntimeId],
    );
    assert.equal(modelResume.length, 1);
    assert.equal(modelResume[0]?.status, 'queued');
    assert.equal(JSON.parse(modelResume[0]!.payload_json).delegationId, 'join-parent-delegation');
    assert.equal(
      hostRootEnqueues.length,
      0,
      'nested parent must resume through durable child model work, not Root queue',
    );

    await repository.cancelDelegation(scenarioScope, runId, childB.delegationId, 2, now + 4);
    assert.equal(
      (
        await db.queryAll<{ id: string }>(
          `SELECT id FROM agent_scheduler_work
           WHERE run_id = ? AND agent_runtime_id = ? AND kind = 'model_step' AND id LIKE 'model-resume:%'`,
          [runId, parentRuntimeId],
        )
      ).length,
      1,
      'repeated terminal notification must not duplicate the parent model resume work',
    );

    const receipt = await repository.sendMessage({
      scope: scenarioScope,
      id: 'join-normal-completion-message',
      runId,
      senderRuntimeId: childB.runtimeId,
      recipientRuntimeId: parentRuntimeId,
      delegationId: childB.delegationId,
      kind: 'completion',
      idempotencyKey: 'join-normal-completion-key',
      payloadHash: 'join-normal-completion-hash',
      correlationId: childB.delegationId,
      replyTo: null,
      causationId: null,
      taskRevision: 1,
      body: { outcome: 'cancelled' },
      artifactRefs: [],
      sizeBytes: 64,
      expiresAt: now + 600,
      now: now + 5,
      maxPending: 100,
      maxHardRunMessages: 1000,
      maxHardRunBytes: 1_048_576,
    });
    assert.equal(receipt.replayed, false);
    assert.equal(
      (await db.queryOne<{ kind: string }>('SELECT kind FROM agent_messages WHERE id = ?', [receipt.messageId]))?.kind,
      'completion',
    );

    // Root uses the same durable join_resume invariant; only the final handoff target differs.
    await db.execute(
      `UPDATE agent_runtimes SET schedule_state = 'joining', updated_at = ?
       WHERE id = 'join-root-runtime' AND run_id = ? AND status = 'running'`,
      [now + 6, runId],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES
         ('root-join-control-model-step', ?, 'join-root-runtime', 3, 'model', 'completed', 0, '[]', '[]', ?, ?),
         ('root-join-control-step', ?, 'join-root-runtime', 4, 'tool', 'completed', 0, '[]', '[]', ?, ?)`,
      [runId, now + 6, now + 6, runId, now + 6, now + 6],
    );
    const rootJoinInspection = {
      ...joinInspection,
      normalizedArguments: {
        delegationIds: ['join-parent-delegation'],
        mode: 'all',
        deadlineAt: now + 500,
      },
      operationHash: 'root-join-control-hash',
    };
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
         created_at, started_at, completed_at)
       VALUES ('root-join-control-tool-call', ?, 'join-root-runtime', 'root-join-control-step',
               'root-join-control-model-step', 0, 1,
               'provider-root-join-control', 'join_subagents', '1', ?, 'root-join-control-hash', 1,
               'control', 'succeeded', ?, ?, ?, ?)`,
      [runId, JSON.stringify(rootJoinInspection), JSON.stringify(waitingResult), now + 6, now + 6, now + 6],
    );
    await repository.cancelDelegation(scenarioScope, runId, 'join-parent-delegation', 1, now + 7);
    const rootResumeReady = (await repository.readyWork(now + 7, 32)).find(
      (work) => work.kind === 'join_resume' && work.agentRuntimeId === 'join-root-runtime',
    );
    assert.ok(rootResumeReady, 'terminal nested parent must create a durable Root join_resume work');
    const rootResumeClaim = await repository.claimWork(rootResumeReady.id, rootResumeReady.version, 444, now + 7);
    assert.ok(rootResumeClaim);
    await participant.handleJoinResume(scenarioScope, rootResumeClaim, 444);
    assert.equal(
      (
        await db.queryOne<{ schedule_state: string }>(
          "SELECT schedule_state FROM agent_runtimes WHERE id = 'join-root-runtime'",
        )
      )?.schedule_state,
      'runnable',
    );
    assert.deepEqual(hostRootEnqueues, [runId]);

    return [
      { name: 'durable_join_resume_rows', value: resumeRows.length, unit: 'work-items' },
      { name: 'nested_model_resume_rows', value: modelResume.length, unit: 'work-items' },
      { name: 'mailbox_independent_resumes', value: 1, unit: 'joins' },
      { name: 'root_durable_resumes', value: hostRootEnqueues.length, unit: 'runs' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
