import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { JsonValue } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { createRequestUserInputTool } from '../../../packages/backend/src/modules/agent/tools/host/user-input-tools';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { normalizeUserInputQuestions } from '../../../packages/backend/src/modules/agent/runtime/runs/user-input-request';
import { SCENARIO_MODEL_CAPABILITIES, scope } from './scenario-fixtures';

export const userInputClarificationScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-user-input-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'user-input.sqlite', nodeEnv: 'test' });
  const userInputObserverEvents: string[] = [];
  const stateCommit = new SqliteStateCommitAdapter(db, (_run, events) => {
    userInputObserverEvents.push(...events.map((event) => event.type));
  });
  const repository = new SqliteRunRepository(db);
  const requestTool = createRequestUserInputTool({
    sha256Utf8: (value) => createHash('sha256').update(value, 'utf8').digest('hex'),
  });
  const now = 1_800_100_000;
  const runId = 'clarification-run';
  const runtimeId = 'clarification-runtime';
  const threadId = 'clarification-thread';
  const requestArguments = {
    questions: [
      {
        id: 'target',
        prompt: 'Which deployment target should I use?',
        kind: 'choice',
        choices: [
          { value: 'staging', label: 'Staging', description: 'Deploy to the non-production environment.' },
          { value: 'production', label: 'Production', description: 'Deploy to the production environment.' },
        ],
        recommendedChoice: 'staging',
        context: 'The requested deployment target was not specified.',
      },
    ],
  } satisfies JsonValue;
  const questions = normalizeUserInputQuestions(requestArguments.questions);
  const modelAttemptCount = async (): Promise<number> =>
    (
      await db.queryOne<{ count: number }>(
        `SELECT COUNT(*) AS count FROM agent_model_attempts a
         JOIN agent_steps s ON s.id = a.step_id
         WHERE s.run_id = ?`,
        [runId],
      )
    )?.count ?? 0;

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'clarification-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads
        (id, user_id, app_id, title, title_source, next_sequence, created_at, updated_at)
       VALUES (?, 1, 'scenario-app', 'clarification-thread', 'manual', 2, ?, ?)`,
      [threadId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, goal_text, goal_revision, goal_updated_at,
         verification_status, budget_json, definition_json, plan_json, usage_json,
         active_execution_started_at, executing_runtime_count, consumed_input_sequence, input_revision,
         created_at, started_at, updated_at)
       VALUES (?, 1, 'scenario-app', ?, 'running', 'in_progress', ?, 1, ?, 'not_started', ?, ?, ?, ?,
               NULL, 0, 1, 1, ?, ?, ?)`,
      [
        runId,
        threadId,
        'Deploy the service, but the target is not specified.',
        now,
        JSON.stringify({
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
       VALUES ('clarification-initial-input', ?, 1, 'scenario-app', ?, 1, 'user_input', ?, ?)`,
      [threadId, runId, JSON.stringify({ text: 'Deploy the service.', artifactRefs: [] }), now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'executing', 0, 'owner-clarification-runtime', ?, ?)`,
      [
        runtimeId,
        runId,
        JSON.stringify({ providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 }),
        now,
        now,
      ],
    );

    const simulateRootExecutionClaim = async (cycleNow: number): Promise<void> => {
      const runtime = await db.queryOne<{ schedule_state: string }>(
        'SELECT schedule_state FROM agent_runtimes WHERE id = ? AND run_id = ?',
        [runtimeId, runId],
      );
      if (runtime?.schedule_state === 'executing') return;
      assert.equal(runtime?.schedule_state, 'runnable');
      const runtimeChanged = await db.execute(
        `UPDATE agent_runtimes SET schedule_state = 'executing', updated_at = ?
         WHERE id = ? AND run_id = ? AND status = 'running' AND schedule_state = 'runnable'`,
        [cycleNow, runtimeId, runId],
      );
      assert.equal(runtimeChanged.changes, 1);
      const run = await db.queryOne<{ executing_runtime_count: number }>(
        'SELECT executing_runtime_count FROM agent_runs WHERE id = ? AND status = ?',
        [runId, 'running'],
      );
      assert.equal(run?.executing_runtime_count, 0, 'beginModelStep owns the executing runtime counter');
    };

    const runClarificationCycle = async (index: number) => {
      const cycleNow = now + index * 20;
      await simulateRootExecutionClaim(cycleNow);
      const before = await repository.snapshot(scope, runId);
      assert.ok(before);
      assert.equal(before.status, 'running');

      const begunModel = await stateCommit.beginModelStep({
        scope,
        runId,
        runtimeId,
        expectedRunVersion: before.version,
        inputWatermark: before.inputRevision,
        reservedTokens: 1_024,
        estimatedInputTokens: 64,
        reservedOutputTokens: 256,
        contextWindowTokens: 16_384,
        now: cycleNow,
      });
      const inspectionContext: ToolContext = {
        ...scope,
        actor: { kind: 'agent', userId: scope.userId, appId: scope.appId, runId, agentRuntimeId: runtimeId },
        runId,
        agentRuntimeId: runtimeId,
        connectionIds: [],
        environment: null,
        stepId: begunModel.stepId,
        signal: new AbortController().signal,
        deadlineAt: cycleNow + 120,
        maxOutputBytes: begunModel.run.budget.maxToolOutputBytes,
        inputRevision: begunModel.run.inputRevision,
      };
      const inspection = await requestTool.inspect(requestArguments, inspectionContext, 1);
      const providerCallId = `clarification-provider-${index}`;
      const toolCallId = `clarification-tool-${index}`;
      const proposed = await stateCommit.commitToolProposalBatch({
        scope,
        runId,
        runtimeId,
        modelStepId: begunModel.stepId,
        attemptId: begunModel.attemptId,
        expectedRunVersion: begunModel.run.version,
        assistantEntryId: `clarification-assistant-${index}`,
        assistantText: '',
        items: [
          {
            providerCallId,
            toolCallId,
            toolName: requestTool.descriptor.name,
            toolVersion: requestTool.descriptor.version,
            argumentsJson: JSON.stringify(requestArguments),
            inspection,
          },
        ],
        usage: begunModel.run.usage,
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 0,
        estimatedUsage: false,
        finishReason: 'tool-calls',
        now: cycleNow + 1,
      });
      const proposal = proposed.items[0]!;
      const begunTool = await stateCommit.beginReadToolBatch({
        scope,
        runId,
        runtimeId,
        expectedRunVersion: proposed.run.version,
        items: [{ toolStepId: proposal.toolStepId, toolCallId }],
        now: cycleNow + 2,
      });
      const executionContext: ToolContext = {
        ...inspectionContext,
        stepId: proposal.toolStepId,
        inputRevision: begunTool.run.inputRevision,
      };
      const result = await requestTool.execute(inspection, executionContext);
      const requestId = `clarification-request-${index}`;
      const observedRequestedBefore = userInputObserverEvents.filter((type) => type === 'input.requested').length;
      const parked = await stateCommit.settleUserInputRequestTool({
        scope,
        runId,
        runtimeId,
        toolStepId: proposal.toolStepId,
        toolCallId,
        expectedRunVersion: begunTool.run.version,
        toolResultEntryId: `clarification-result-${index}`,
        providerCallId,
        requestId,
        questions,
        result,
        now: cycleNow + 3,
      });
      assert.equal(parked.run.status, 'awaiting_input');
      assert.equal(
        userInputObserverEvents.filter((type) => type === 'input.requested').length - observedRequestedBefore,
        1,
        'each P-076 input.requested transition must reach the post-commit durable observer exactly once',
      );
      assert.equal(parked.run.executingRuntimeCount, 0);
      const persisted = await repository.snapshot(scope, runId);
      assert.ok(persisted);
      assert.deepEqual(persisted.pendingInputRequest, {
        id: requestId,
        runtimeId,
        questions,
        requestedAt: cycleNow + 3,
      });
      const runtime = await db.queryOne<{ schedule_state: string }>(
        'SELECT schedule_state FROM agent_runtimes WHERE id = ? AND run_id = ?',
        [runtimeId, runId],
      );
      assert.equal(runtime?.schedule_state, 'waiting_message');
      return { cycleNow, parked, requestId };
    };

    let answersResumed = 0;
    let guardPauses = 0;
    for (let index = 1; index <= 5; index += 1) {
      const cycle = await runClarificationCycle(index);
      const attemptsWhileWaiting = await modelAttemptCount();
      const guard = await db.queryOne<{ paused_runtime_id: string | null; no_progress_count: number }>(
        'SELECT paused_runtime_id, no_progress_count FROM agent_loop_guards WHERE run_id = ?',
        [runId],
      );
      if (index < 5) assert.equal(guard?.paused_runtime_id ?? null, null);
      else {
        assert.equal(
          guard?.paused_runtime_id,
          runtimeId,
          'repeated clarification must use the existing P-045 pause owner',
        );
        guardPauses += 1;
      }
      const answerEntryId = `clarification-answer-${index}`;
      const resumed = await stateCommit.appendInput({
        scope,
        runId,
        inputEntryId: answerEntryId,
        input: { text: 'target: staging', artifactRefs: [] },
        mode: 'append',
        expectedRunVersion: cycle.parked.run.version,
        idempotencyKey: `clarification-answer-key-${index}`,
        requestHash: `clarification-answer-hash-${index}`,
        now: cycle.cycleNow + 4,
      });
      assert.equal(resumed.run.status, 'running');
      assert.equal(resumed.shouldReschedule, true);
      assert.equal(
        await modelAttemptCount(),
        attemptsWhileWaiting,
        'answering must not create an extra model attempt itself',
      );
      const request = await db.queryOne<{ status: string; answer_entry_id: string | null }>(
        'SELECT status, answer_entry_id FROM agent_input_requests WHERE id = ?',
        [cycle.requestId],
      );
      assert.deepEqual(request, { status: 'answered', answer_entry_id: answerEntryId });
      const resumedSnapshot = await repository.snapshot(scope, runId);
      assert.ok(resumedSnapshot);
      assert.equal(resumedSnapshot.pendingInputRequest, null);
      const runtime = await db.queryOne<{ schedule_state: string }>(
        'SELECT schedule_state FROM agent_runtimes WHERE id = ? AND run_id = ?',
        [runtimeId, runId],
      );
      assert.equal(runtime?.schedule_state, 'runnable');
      if (index === 5) {
        const resetGuard = await db.queryOne<{
          paused_runtime_id: string | null;
          no_progress_count: number;
        }>('SELECT paused_runtime_id, no_progress_count FROM agent_loop_guards WHERE run_id = ?', [runId]);
        assert.deepEqual(resetGuard, { paused_runtime_id: null, no_progress_count: 0 });
      }
      answersResumed += 1;
    }

    const cancellationCycle = await runClarificationCycle(6);
    const attemptsBeforeCancel = await modelAttemptCount();
    const cancelled = await stateCommit.cancelRun({
      scope,
      runId,
      expectedRunVersion: cancellationCycle.parked.run.version,
      idempotencyKey: 'clarification-cancel-key',
      requestHash: 'clarification-cancel-hash',
      now: cancellationCycle.cycleNow + 4,
    });
    assert.equal(cancelled.run.status, 'cancelled');
    assert.equal(await modelAttemptCount(), attemptsBeforeCancel);
    const cancelledRequest = await db.queryOne<{ status: string }>(
      'SELECT status FROM agent_input_requests WHERE id = ?',
      [cancellationCycle.requestId],
    );
    assert.deepEqual(cancelledRequest, { status: 'cancelled' });
    const cancelledSnapshot = await repository.snapshot(scope, runId);
    assert.ok(cancelledSnapshot);
    assert.equal(cancelledSnapshot.pendingInputRequest, null);

    const inputRequestEvents = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM agent_events WHERE run_id = ? AND type = 'input.requested'",
      [runId],
    );
    assert.equal(inputRequestEvents?.count, 6);
    const loopDetectedEvents = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM agent_events WHERE run_id = ? AND type = 'run.loop_detected'",
      [runId],
    );
    assert.equal(loopDetectedEvents?.count, 1);

    return [
      { name: 'clarification_requests_parked', value: inputRequestEvents?.count ?? 0, unit: 'requests' },
      { name: 'clarification_answers_resumed', value: answersResumed, unit: 'answers' },
      { name: 'model_attempts_created_while_waiting', value: 0, unit: 'attempts' },
      { name: 'clarification_loop_guard_pauses', value: guardPauses, unit: 'pauses' },
      {
        name: 'unanswered_requests_cancelled',
        value: cancelledRequest?.status === 'cancelled' ? 1 : 0,
        unit: 'requests',
      },
    ];
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
