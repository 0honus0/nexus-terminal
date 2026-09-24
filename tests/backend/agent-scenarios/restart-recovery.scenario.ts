import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteLeaseRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-lease.repository';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { SqliteCheckpointRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-checkpoint.repository';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { resolveProviderModelConfig } from '../../../packages/backend/src/modules/agent/ai/model-capability-resolver';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { CheckpointService } from '../../../packages/backend/src/modules/agent/runtime/recovery/checkpoint.service';
import type { RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { SCENARIO_MODEL_CAPABILITIES, scope } from './scenario-fixtures';

export const restartRecoveryScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-scenario-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'restart.sqlite', nodeEnv: 'test' });
  const restartObserverEvents: Array<{ runId: string; type: string }> = [];
  const stateCommit = new SqliteStateCommitAdapter(db, (run, events) => {
    for (const event of events) restartObserverEvents.push({ runId: run.id, type: event.type });
  });
  const leases = new SqliteLeaseRepository(db);
  const now = 1_800_000_000;

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
    model: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
    rootModelRoutes: [],
    approvalMode: 'ask',
    executionMode: 'execute',
    connectionIds: [],
    environment: null,
    policyRevision: 1,
    settingsRevision: 1,
  });
  const plan = JSON.stringify({ schemaVersion: 1, revision: 0, items: [] });
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });
  const modelRef = JSON.stringify({
    providerId: 'scenario-provider',
    modelId: 'scenario-model',
    configurationVersion: 1,
  });

  const insertRun = async (id: string, threadId: string, runtimeId: string): Promise<void> => {
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES (?, 1, 'scenario-app', ?, 'manual', ?, ?)`,
      [threadId, threadId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, 'scenario-app', ?, 'running', 'in_progress', 'not_started', ?, ?, ?, ?, 1, ?, ?, ?)`,
      [id, threadId, budget, definition, plan, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'executing', 0, ?, ?, ?)`,
      [runtimeId, id, modelRef, `owner-${runtimeId}`, now, now],
    );
  };

  const toolInspection = (
    toolName: string,
    resourceKey: string,
    risk: 'read' | 'mutate',
    operationHash: string,
  ): string =>
    JSON.stringify({
      toolName,
      toolVersion: '1',
      normalizedArguments: { path: '/workspace/example.txt' },
      target: {
        kind: 'workspace',
        target: 'workspace',
        id: 'scenario-workspace',
        targetIdentity: 'scenario-workspace',
        endpoint: '',
        loginUser: '',
        configurationHash: 'scenario',
        workspaceId: 'scenario-workspace',
        generation: 1,
      },
      resourceKeys: [resourceKey],
      risk,
      mutation: risk === 'mutate',
      operationHash,
      operationHashVersion: 1,
      preconditions: [],
      policyRevision: 1,
      inputRevision: 0,
    });

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'scenario-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 6, ?, ?)`,
      [now, now],
    );

    await insertRun('model-run', 'model-thread', 'model-runtime');
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES ('model-step', 'model-run', 'model-runtime', 1, 'model', 'running', 0, '[]', '[]', ?)`,
      [now],
    );
    await db.execute(
      `INSERT INTO agent_model_attempts
        (id, step_id, attempt_index, status, reserved_tokens, created_at)
       VALUES ('model-attempt', 'model-step', 1, 'streaming', 4096, ?)`,
      [now],
    );

    await insertRun('read-run', 'read-thread', 'read-runtime');
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES
         ('read-model-step', 'read-run', 'read-runtime', 1, 'model', 'completed', 0, '[]', '[]', ?, ?),
         ('read-step', 'read-run', 'read-runtime', 2, 'tool', 'running', 0, '[]', '[]', ?, NULL)`,
      [now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, created_at, started_at)
       VALUES ('read-tool', 'read-run', 'read-runtime', 'read-step', 'read-model-step', 'provider-read', 'file_read', '1',
               ?, 'sha256:read', 1, 'read', 'running', ?, ?)`,
      [toolInspection('file_read', 'workspace:read', 'read', 'sha256:read'), now, now],
    );

    await insertRun('mutation-run', 'mutation-thread', 'mutation-runtime');
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES
         ('mutation-model-step', 'mutation-run', 'mutation-runtime', 1, 'model', 'completed', 0, '[]', '[]', ?, ?),
         ('mutation-step', 'mutation-run', 'mutation-runtime', 2, 'tool', 'running', 0, '[]', '[]', ?, NULL)`,
      [now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, created_at, started_at)
       VALUES ('mutation-tool', 'mutation-run', 'mutation-runtime', 'mutation-step', 'mutation-model-step', 'provider-mutation',
               'workspace_write_file', '1', ?, 'sha256:mutation', 1, 'mutate', 'running', ?, ?)`,
      [toolInspection('workspace_write_file', 'workspace:mutation', 'mutate', 'sha256:mutation'), now, now],
    );
    await db.execute("INSERT INTO agent_resource_fences (resource_key, next_fence) VALUES ('workspace:mutation', 2)");
    await db.execute(
      `INSERT INTO agent_leases
        (id, resource_key, mode, owner_type, owner_id, fence, acquired_at, expires_at, active_mutation, operation_id)
       VALUES ('mutation-lease', 'workspace:mutation', 'write', 'agent', 'mutation-runtime', 1, ?, ?, 1, 'mutation-tool')`,
      [now, now + 300],
    );

    const safeRunId = randomUUID();
    const safeThreadId = randomUUID();
    const safeRuntimeId = randomUUID();
    await insertRun(safeRunId, safeThreadId, safeRuntimeId);
    const fallbackRef = {
      providerId: 'scenario-provider',
      modelId: 'scenario-fallback-model',
      configurationVersion: 1,
    };
    await db.execute('UPDATE agent_runs SET definition_json=? WHERE id=?', [
      JSON.stringify({
        ...(JSON.parse(definition) as Record<string, unknown>),
        rootModelRoutes: [
          {
            model: fallbackRef,
            modelCapabilities: {
              contextWindow: 16_384,
              maxOutputTokens: 4_096,
              supportsTools: true,
              supportsImageInput: false,
              supportsFileInput: false,
            },
          },
        ],
      }),
      safeRunId,
    ]);
    await db.execute('UPDATE agent_runtimes SET model_ref_json=? WHERE id=?', [
      JSON.stringify(fallbackRef),
      safeRuntimeId,
    ]);
    const runRepository = new SqliteRunRepository(db);
    const checkpointRepository = new SqliteCheckpointRepository(db);
    let recoveryNow = now;
    const recoveryModel = resolveProviderModelConfig({
      id: 'scenario-model',
      capabilityOverrides: {
        contextWindow: 16_384,
        maxOutputTokens: 4_096,
        supportsTools: true,
        supportsImageInput: false,
        supportsFileInput: false,
      },
    });
    const recoveryFallbackModel = resolveProviderModelConfig({
      id: fallbackRef.modelId,
      capabilityOverrides: {
        contextWindow: 16_384,
        maxOutputTokens: 4_096,
        supportsTools: true,
        supportsImageInput: false,
        supportsFileInput: false,
      },
    });
    const recoveredRuns: RunView[] = [];
    const restartJobId = `job-${'a'.repeat(64)}`;
    let restartJobStatus: 'running' | 'succeeded' = 'running';
    let restartJobQueries = 0;
    let restartJobStarts = 0;
    const restartJobGateway = {
      queryJob: async (jobId: string) => {
        restartJobQueries += 1;
        assert.equal(jobId, restartJobId);
        return {
          jobId,
          workspaceId: 'restart-job-workspace',
          generation: 1,
          status: restartJobStatus,
          result:
            restartJobStatus === 'succeeded'
              ? {
                  exitCode: 0,
                  signal: null,
                  stdout: 'done',
                  stderr: '',
                  truncated: false,
                  timedOut: false,
                }
              : null,
          error: null,
          createdAt: now,
          completedAt: restartJobStatus === 'succeeded' ? recoveryNow : null,
        };
      },
      startJob: async () => {
        restartJobStarts += 1;
        throw new Error('P-085 recovery must never resubmit a durable background job');
      },
    };
    const recoveryService = new CheckpointService(
      checkpointRepository,
      runRepository,
      {
        get: async () => ({
          revision: 1,
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
      {
        get: async () => ({
          id: 'scenario-provider',
          enabled: true,
          version: 1,
          models: [recoveryModel, recoveryFallbackModel],
        }),
      } as never,
      {
        require: () => ({
          id: 'scenario-agent',
          version: 'scenario-definition-v1',
          displayName: 'Restart recovery scenario',
          description: 'P-085 safe-point fixture',
          requiredModelCapabilities: [],
        }),
      } as never,
      { isDenied: async () => false } as never,
      stateCommit,
      { nowUnixSeconds: () => recoveryNow } as never,
      (run) => recoveredRuns.push(run),
      () => undefined,
      null,
      restartJobGateway as never,
    );
    const mutationBeforeRestart = await runRepository.snapshot(scope, 'mutation-run');
    assert.ok(mutationBeforeRestart);
    assert.equal(
      await recoveryService.recordSafePoint(mutationBeforeRestart, 'model_boundary', true),
      null,
      'a running/unknown mutation must not produce a recovery checkpoint even if a caller reaches the writer',
    );
    assert.equal(await checkpointRepository.latestRecovery(scope, 'mutation-run'), null);

    const safeBeforeRestart = await runRepository.snapshot(scope, safeRunId);
    assert.ok(safeBeforeRestart);
    const firstRecoveryCheckpoint = await recoveryService.recordSafePoint(safeBeforeRestart, 'model_boundary');
    assert.ok(firstRecoveryCheckpoint);
    assert.equal(firstRecoveryCheckpoint.kind, 'recovery');
    assert.deepEqual(
      firstRecoveryCheckpoint.snapshot.activeModel,
      fallbackRef,
      'rolling recovery checkpoint must freeze the active fallback route, not silently revert to the primary model',
    );
    recoveryNow += 31;
    const secondRecoveryCheckpoint = await recoveryService.recordSafePoint(safeBeforeRestart, 'read_batch');
    assert.ok(secondRecoveryCheckpoint);
    assert.notEqual(
      secondRecoveryCheckpoint.id,
      firstRecoveryCheckpoint.id,
      'rolling recovery checkpoint must replace the prior safe point after the bounded interval',
    );
    const recoveryRowsBeforeRestart = (await checkpointRepository.list(scope, safeRunId)).filter(
      (checkpoint) => checkpoint.kind === 'recovery',
    );
    assert.equal(recoveryRowsBeforeRestart.length, 1, 'each Run must retain only one rolling recovery checkpoint');

    const jobRunId = randomUUID();
    const jobThreadId = randomUUID();
    const jobRuntimeId = randomUUID();
    await insertRun(jobRunId, jobThreadId, jobRuntimeId);
    const jobBeforeLaunch = await runRepository.snapshot(scope, jobRunId);
    assert.ok(jobBeforeLaunch);
    const preJobCheckpoint = await recoveryService.recordSafePoint(jobBeforeLaunch, 'model_boundary', true);
    assert.ok(preJobCheckpoint);
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES
         ('restart-job-model-step', ?, ?, 1, 'model', 'completed', 0, '[]', '[]', ?, ?),
         ('restart-job-tool-step', ?, ?, 2, 'tool', 'completed', 0, '[]', '[]', ?, ?)`,
      [jobRunId, jobRuntimeId, now, now, jobRunId, jobRuntimeId, now, now],
    );
    const restartJobResult = JSON.stringify({
      ok: true,
      summary: 'Background workspace job accepted.',
      data: {
        jobId: restartJobId,
        workspaceId: 'restart-job-workspace',
        generation: 1,
        status: 'running',
      },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      semantic: {
        kind: 'execution',
        target: { target: 'workspace', id: 'restart-job-workspace' },
        status: 'running',
        job: {
          jobId: restartJobId,
          workspaceId: 'restart-job-workspace',
          generation: 1,
        },
      },
      verification: {
        status: 'unverified',
        summary: 'Background acceptance is not terminal execution evidence.',
        evidenceRefs: [],
      },
    });
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
         created_at, started_at, completed_at)
       VALUES ('restart-job-tool', ?, ?, 'restart-job-tool-step', 'restart-job-model-step', 'provider-restart-job',
               'shell_execute', '1', ?, 'sha256:restart-job', 1, 'mutate', 'succeeded', ?, ?, ?, ?)`,
      [
        jobRunId,
        jobRuntimeId,
        JSON.stringify({
          toolName: 'shell_execute',
          toolVersion: '1',
          normalizedArguments: {
            target: 'workspace',
            id: 'restart-job-workspace',
            command: { kind: 'argv', argv: ['hold'] },
            cwd: '/workspace/work',
            timeoutSeconds: 60,
            mode: 'background',
          },
          target: {
            kind: 'workspace',
            target: 'workspace',
            id: 'restart-job-workspace',
            targetIdentity: 'workspace:restart-job-workspace:1',
            endpoint: 'workspace:restart-job-workspace',
            loginUser: 'runner:65532',
            configurationHash: 'restart-job-config',
            workspaceId: 'restart-job-workspace',
            generation: 1,
          },
          resourceKeys: ['workspace:restart-job-workspace:1'],
          risk: 'mutate',
          mutation: true,
          operationHash: 'sha256:restart-job',
          operationHashVersion: 1,
          preconditions: [],
          policyRevision: 1,
          inputRevision: 0,
        }),
        restartJobResult,
        now,
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_events (event_id,run_id,sequence,schema_version,type,payload_json,occurred_at)
       VALUES (?, ?, 1, 1, 'tool.started', ?, ?)`,
      [randomUUID(), jobRunId, JSON.stringify({ toolCallId: 'restart-job-tool' }), now],
    );
    await db.execute('UPDATE agent_runs SET next_event_sequence=2 WHERE id=?', [jobRunId]);
    const jobRunWithActiveBackground = await runRepository.snapshot(scope, jobRunId);
    assert.ok(jobRunWithActiveBackground);
    await assert.rejects(
      () => recoveryService.save(scope, jobRunId, jobRunWithActiveBackground.version),
      /CHECKPOINT_BACKGROUND_JOB_UNRESOLVED/,
      'manual checkpoints must fail closed while a durable background job is unresolved',
    );

    const staleInputRunId = randomUUID();
    const staleInputThreadId = randomUUID();
    const staleInputRuntimeId = randomUUID();
    await insertRun(staleInputRunId, staleInputThreadId, staleInputRuntimeId);
    const staleInputBeforeChange = await runRepository.snapshot(scope, staleInputRunId);
    assert.ok(staleInputBeforeChange);
    const staleInputCheckpoint = await recoveryService.recordSafePoint(staleInputBeforeChange, 'model_boundary', true);
    assert.ok(staleInputCheckpoint);
    await db.execute(
      `UPDATE agent_runs
       SET input_revision=input_revision+1, version=version+1, updated_at=?
       WHERE id=?`,
      [recoveryNow, staleInputRunId],
    );

    const restartAt = recoveryNow + 1;
    const interruptedResult = await stateCommit.interruptNonTerminalRuns(restartAt);
    assert.ok(
      Array.isArray(interruptedResult),
      'P-085 startup recovery requires authoritative interrupted Run identities, not only a count, so rolling recovery checkpoints can be validated after reconciliation',
    );
    const interrupted = interruptedResult;
    recoveryNow = restartAt + 1;
    assert.equal(interrupted.length, 6);
    assert.equal(
      restartObserverEvents.filter((item) => item.type === 'run.interrupted').length,
      6,
      'backend restart transitions must reach the post-commit durable observer exactly once per Run',
    );

    const interruptedSafeRun = interrupted.find((run) => run.id === safeRunId);
    assert.ok(interruptedSafeRun);
    await assert.rejects(
      () =>
        recoveryService.resume(scope, safeRunId, secondRecoveryCheckpoint.id, interruptedSafeRun.version, randomUUID()),
      (error: unknown) => error instanceof Error && error.message === 'CHECKPOINT_USER_KIND_REQUIRED',
      'rolling recovery checkpoints must not be resumable through the user/manual resume API',
    );

    const continued = await recoveryService.recoverInterrupted(interrupted);
    assert.equal(continued.length, 1, 'only the Run with a valid rolling recovery checkpoint may auto-continue');
    assert.equal(recoveredRuns.length, 1);
    for (const runId of ['model-run', 'read-run']) {
      const missingCheckpointFailure = await db.queryOne<{ payload_json: string }>(
        `SELECT payload_json FROM agent_events
         WHERE run_id=? AND type='run.recovery_failed' ORDER BY sequence DESC LIMIT 1`,
        [runId],
      );
      assert.ok(missingCheckpointFailure, 'an interrupted Run without a rolling checkpoint must fail visibly');
      assert.equal(
        (JSON.parse(missingCheckpointFailure.payload_json) as { reasons?: string[] }).reasons?.includes(
          'CHECKPOINT_NOT_FOUND',
        ),
        true,
        'missing recovery checkpoints must be auditable instead of silently leaving the Run interrupted',
      );
    }
    assert.equal(continued[0]!.parentRunId, safeRunId);
    assert.equal(
      continued[0]!.definition.model.modelId,
      'scenario-model',
      'Run definition primary model remains frozen even when the active runtime route is a fallback',
    );
    assert.deepEqual(
      await runRepository.rootRuntimeModel(scope, continued[0]!.id),
      fallbackRef,
      'restart continuation must preserve the checkpointed active fallback route in the new root runtime',
    );
    const staleInputSource = await runRepository.snapshot(scope, staleInputRunId);
    assert.ok(staleInputSource);
    assert.equal(staleInputSource.status, 'interrupted');
    const staleInputFailure = await db.queryOne<{ payload_json: string }>(
      `SELECT payload_json FROM agent_events
       WHERE run_id=? AND type='run.recovery_failed' ORDER BY sequence DESC LIMIT 1`,
      [staleInputRunId],
    );
    assert.ok(staleInputFailure, 'stale input revision must leave an auditable recovery failure');
    assert.equal(
      (JSON.parse(staleInputFailure.payload_json) as { reasons?: string[] }).reasons?.includes(
        'CHECKPOINT_INPUT_STALE',
      ),
      true,
      'restart continuation must fail closed when inputRevision changed after the rolling checkpoint',
    );
    const safeSourceAfterRecovery = await runRepository.snapshot(scope, safeRunId);
    assert.equal(safeSourceAfterRecovery?.status, 'interrupted');
    assert.equal(
      restartObserverEvents.some((item) => item.runId === safeRunId && item.type === 'run.recovery_continued'),
      true,
      'source Run must durably record backend restart continuation',
    );
    const continuationNotice = await db.queryOne<{ payload_json: string }>(
      `SELECT payload_json FROM ai_thread_entries
       WHERE run_id=? AND kind='system_notice' ORDER BY sequence DESC LIMIT 1`,
      [continued[0]!.id],
    );
    assert.ok(continuationNotice);
    assert.equal(
      (JSON.parse(continuationNotice.payload_json) as { type?: string; reason?: string }).type,
      'continued_from_checkpoint',
    );
    assert.equal(
      (JSON.parse(continuationNotice.payload_json) as { type?: string; reason?: string }).reason,
      'backend_restart',
    );

    const deferredJobSource = await runRepository.snapshot(scope, jobRunId);
    assert.ok(deferredJobSource);
    assert.equal(deferredJobSource.status, 'interrupted');
    assert.equal(
      restartObserverEvents.some((item) => item.runId === jobRunId && item.type === 'run.recovery_deferred'),
      true,
      'a still-running durable background job must leave the source interrupted with an auditable deferred recovery',
    );
    assert.equal(
      restartObserverEvents.some((item) => item.runId === jobRunId && item.type === 'run.recovery_failed'),
      false,
      'a healthy still-running durable job is not a recovery failure',
    );
    assert.equal(restartJobStarts, 0, 'restart recovery must query Runner journal state and never resubmit the job');
    assert.ok(
      restartJobQueries >= 1,
      'restart recovery must query the durable Runner job before deciding continuation',
    );

    const originalLatestRecovery = checkpointRepository.latestRecovery.bind(checkpointRepository);
    let failDeferredLookupOnce = true;
    checkpointRepository.latestRecovery = async (candidateScope, candidateRunId) => {
      if (candidateRunId === jobRunId && failDeferredLookupOnce) {
        failDeferredLookupOnce = false;
        throw new Error('TRANSIENT_CHECKPOINT_LOOKUP');
      }
      return originalLatestRecovery(candidateScope, candidateRunId);
    };
    assert.equal(
      await recoveryService.retryDeferredRecoveries(),
      0,
      'a transient checkpoint lookup failure must leave deferred recovery scheduled for the next sweep',
    );
    checkpointRepository.latestRecovery = originalLatestRecovery;
    assert.equal(
      restartObserverEvents.some((item) => item.runId === jobRunId && item.type === 'run.recovery_failed'),
      false,
      'transient deferred-recovery lookup failures must not be misclassified as terminal recovery failures',
    );

    restartJobStatus = 'succeeded';
    recoveryNow += 1;
    const deferredRecovered = await recoveryService.retryDeferredRecoveries();
    assert.equal(
      deferredRecovered,
      1,
      'the recovery sweep must retry a deferred Run after its durable job becomes terminal',
    );
    const continuedJob = recoveredRuns.find((run) => run.parentRunId === jobRunId);
    assert.ok(continuedJob, 'terminal durable background job recovery must create one continuation Run');
    assert.equal(continuedJob.parentRunId, jobRunId);
    assert.equal(restartJobStarts, 0, 'terminal job recovery must still avoid duplicate submission');
    const terminalJobCheckpoint = await checkpointRepository.latestRecovery(scope, jobRunId);
    assert.ok(terminalJobCheckpoint);
    assert.deepEqual(
      terminalJobCheckpoint.snapshot.recoveryManifest?.backgroundJobs.map((job) => [job.jobId, job.status]),
      [[restartJobId, 'succeeded']],
      'restart recapture must freeze the terminal Runner journal observation in the existing recovery manifest',
    );

    const modelAttempt = await db.queryOne<{ status: string; completed_at: number | null; error_code: string | null }>(
      "SELECT status, completed_at, error_code FROM agent_model_attempts WHERE id = 'model-attempt'",
    );
    assert.deepEqual(modelAttempt, { status: 'aborted', completed_at: restartAt, error_code: 'BACKEND_RESTART' });
    const modelStep = await db.queryOne<{ status: string; completed_at: number | null }>(
      "SELECT status, completed_at FROM agent_steps WHERE id = 'model-step'",
    );
    assert.deepEqual(modelStep, { status: 'cancelled', completed_at: restartAt });

    const readTool = await db.queryOne<{ status: string; completed_at: number | null }>(
      "SELECT status, completed_at FROM agent_tool_calls WHERE id = 'read-tool'",
    );
    assert.deepEqual(readTool, { status: 'cancelled', completed_at: restartAt });
    const readStep = await db.queryOne<{ status: string; completed_at: number | null }>(
      "SELECT status, completed_at FROM agent_steps WHERE id = 'read-step'",
    );
    assert.deepEqual(readStep, { status: 'cancelled', completed_at: restartAt });

    const mutationRun = await db.queryOne<{ version: number; needs_reconciliation: number; status: string }>(
      "SELECT version, needs_reconciliation, status FROM agent_runs WHERE id = 'mutation-run'",
    );
    assert.deepEqual(mutationRun, { version: 2, needs_reconciliation: 1, status: 'interrupted' });
    const quarantine = await db.queryOne<{
      resource_key: string;
      tool_call_id: string | null;
      reason: string;
      version: number;
    }>(
      "SELECT resource_key, tool_call_id, reason, version FROM agent_resource_quarantine WHERE resource_key = 'workspace:mutation'",
    );
    assert.deepEqual(quarantine, {
      resource_key: 'workspace:mutation',
      tool_call_id: 'mutation-tool',
      reason: 'BACKEND_RESTART_DURING_MUTATION',
      version: 1,
    });
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_tool_calls WHERE id = 'mutation-tool'"))?.status,
      'reconciling',
    );
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_steps WHERE id = 'mutation-step'"))?.status,
      'failed',
    );

    await assert.rejects(
      leases.acquireMany({ type: 'system', id: 'before-reconcile' }, ['workspace:mutation'], 'write', 30),
      (error: unknown) => error instanceof Error && error.message === 'RESOURCE_QUARANTINED',
    );

    await stateCommit.resolveRunReconciliation({
      scope,
      runId: 'mutation-run',
      expectedRunVersion: 2,
      note: 'scenario verified the external mutation outcome',
      resources: [{ resourceKey: quarantine!.resource_key, version: quarantine!.version }],
      now: restartAt + 2,
    });
    assert.equal(
      await db.queryOne("SELECT resource_key FROM agent_resource_quarantine WHERE resource_key = 'workspace:mutation'"),
      null,
    );
    assert.equal(await db.queryOne("SELECT id FROM agent_leases WHERE id = 'mutation-lease'"), null);
    assert.equal(
      (await db.queryOne<{ status: string }>("SELECT status FROM agent_tool_calls WHERE id = 'mutation-tool'"))?.status,
      'failed',
    );
    const resolvedRun = await db.queryOne<{ version: number; needs_reconciliation: number }>(
      "SELECT version, needs_reconciliation FROM agent_runs WHERE id = 'mutation-run'",
    );
    assert.deepEqual(resolvedRun, { version: 3, needs_reconciliation: 0 });

    const probe = await leases.acquireMany(
      { type: 'system', id: 'after-reconcile' },
      ['workspace:mutation'],
      'write',
      30,
    );
    assert.equal(probe.length, 1);
    await leases.release(
      probe.map((lease) => lease.id),
      { type: 'system', id: 'after-reconcile' },
    );

    const deleted = await stateCommit.deleteRun({
      scope,
      runId: 'mutation-run',
      expectedRunVersion: 3,
      idempotencyKey: 'scenario-delete-mutation',
      requestHash: 'scenario-delete-mutation-v1',
      now: restartAt + 3,
    });
    assert.equal(deleted.deleted, true);
    assert.equal(await db.queryOne("SELECT id FROM agent_runs WHERE id = 'mutation-run'"), null);

    return [
      { name: 'interrupted_runs', value: interrupted.length, unit: 'runs' },
      { name: 'restart_auto_continuations', value: recoveredRuns.length, unit: 'runs' },
      { name: 'deferred_background_recoveries', value: deferredRecovered, unit: 'runs' },
      { name: 'rolling_recovery_checkpoint_rows', value: recoveryRowsBeforeRestart.length, unit: 'checkpoints' },
      { name: 'restart_background_job_queries', value: restartJobQueries, unit: 'queries' },
      { name: 'restart_background_job_resubmits', value: restartJobStarts, unit: 'jobs' },
      { name: 'restart_fallback_routes_preserved', value: 1, unit: 'runs' },
      { name: 'restart_stale_input_rejections', value: 1, unit: 'runs' },
      { name: 'restart_manual_recovery_resume_rejections', value: 1, unit: 'runs' },
      { name: 'materialized_quarantines', value: 1, unit: 'resources' },
      { name: 'resolved_mutations', value: 1, unit: 'tools' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
