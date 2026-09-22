import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ToolResult } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { completionGateDecision } from '../../../packages/backend/src/modules/agent/runtime/execution/completion-gate';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { SCENARIO_MODEL_CAPABILITIES, scope } from './scenario-fixtures';

export const completionGateScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-completion-gate-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'completion.sqlite', nodeEnv: 'test' });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const repository = new SqliteRunRepository(db);
  const now = 1_800_000_000;
  const usage = {
    inputTokens: 20,
    outputTokens: 10,
    cachedInputTokens: 0,
    steps: 2,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  };
  const inspection = (toolName: string, normalizedArguments: Record<string, unknown>, operationHash: string): string =>
    JSON.stringify({
      toolName,
      toolVersion: '1.0.0',
      normalizedArguments,
      target: {
        kind: 'workspace',
        target: 'workspace',
        id: 'gate-workspace',
        targetIdentity: 'workspace:gate-workspace:1',
        endpoint: 'workspace:gate-workspace',
        loginUser: 'runner:65532',
        configurationHash: 'gate-config',
        workspaceId: 'gate-workspace',
        generation: 1,
      },
      resourceKeys: ['workspace:gate-workspace:1'],
      risk: 'mutate',
      mutation: true,
      operationHash,
      operationHashVersion: 1,
      preconditions: [],
      policyRevision: 1,
      inputRevision: 0,
    });
  const successfulResult = (
    summary: string,
    verificationStatus: 'verified' | 'unverified',
    semantic?: ToolResult['semantic'],
  ): string =>
    JSON.stringify({
      ok: true,
      summary,
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      ...(semantic === undefined ? {} : { semantic }),
      verification: {
        status: verificationStatus,
        summary: `${summary} ${verificationStatus}`,
        evidenceRefs: [],
      },
    });

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'completion-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('completion-thread', 1, 'scenario-app', 'completion-thread', 'manual', ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, goal_text, goal_revision, goal_updated_at,
         verification_status, budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES ('completion-run', 1, 'scenario-app', 'completion-thread', 'running', 'in_progress',
               'Update the code and run tests before finishing.', 1, ?, 'not_started', ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
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
       VALUES ('completion-runtime', 'completion-run', 'root', 'native', ?, 'running', 'executing', 0,
               'owner-completion-runtime', ?, ?)`,
      [
        JSON.stringify({ providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 }),
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES
         ('completion-model-source', 'completion-run', 'completion-runtime', 1, 'model', 'completed', 0, '[]', '[]', ?, ?),
         ('completion-write-step', 'completion-run', 'completion-runtime', 2, 'tool', 'completed', 0, '[]', '[]', ?, ?),
         ('completion-stop-step', 'completion-run', 'completion-runtime', 3, 'model', 'running', 0, '[]', '[]', ?, NULL)`,
      [now, now, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_model_attempts
        (id, step_id, attempt_index, status, reserved_tokens, created_at)
       VALUES ('completion-stop-attempt', 'completion-stop-step', 1, 'streaming', 4096, ?)`,
      [now],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, result_json, created_at, started_at, completed_at)
       VALUES ('completion-write', 'completion-run', 'completion-runtime', 'completion-write-step',
               'completion-model-source', 'provider-write', 'file_write', '1.0.0', ?, 'gate-write', 1,
               'mutate', 'succeeded', ?, ?, ?, ?)`,
      [
        inspection('file_write', { path: '/workspace/work/example.ts' }, 'gate-write'),
        successfulResult('File write', 'unverified'),
        now,
        now,
        now,
      ],
    );

    const beforeGate = await repository.snapshot(scope, 'completion-run');
    assert.ok(beforeGate);
    const initialEvidence = await repository.completionEvidence(scope, 'completion-run');
    const firstDecision = completionGateDecision(beforeGate, initialEvidence, beforeGate.goal.text ?? '');
    assert.equal(
      firstDecision.kind,
      'continue',
      'a coding mutation with requested tests must not complete before test evidence',
    );
    assert.equal(firstDecision.kind === 'continue' ? firstDecision.reasonCode : null, 'COMPLETION_EVIDENCE_REQUIRED');

    const continued = await stateCommit.continueModelStepForCompletionGate({
      scope,
      runId: 'completion-run',
      runtimeId: 'completion-runtime',
      stepId: 'completion-stop-step',
      attemptId: 'completion-stop-attempt',
      expectedRunVersion: beforeGate.version,
      assistantEntryId: 'completion-premature-answer',
      assistantText: 'Implementation is done.',
      noticeEntryId: 'completion-gate-notice',
      notice: firstDecision.kind === 'continue' ? firstDecision.notice : 'unexpected',
      reasonCode: 'COMPLETION_EVIDENCE_REQUIRED',
      inputTokens: 40,
      outputTokens: 12,
      cachedInputTokens: 0,
      estimatedUsage: false,
      finishReason: 'stop',
      now: now + 1,
    });
    assert.equal(continued.run.status, 'running');
    assert.equal(
      continued.run.executingRuntimeCount,
      1,
      'completion gate continuation must retain Root execution ownership',
    );
    const notice = await db.queryOne<{ kind: string; payload_json: string }>(
      "SELECT kind, payload_json FROM ai_thread_entries WHERE id = 'completion-gate-notice'",
    );
    assert.equal(notice?.kind, 'system_notice');
    assert.equal((JSON.parse(notice?.payload_json ?? '{}') as { kind?: unknown }).kind, 'completion_gate');

    const afterGate = await repository.snapshot(scope, 'completion-run');
    assert.ok(afterGate);
    const repeatedEvidence = await repository.completionEvidence(scope, 'completion-run');
    assert.equal(repeatedEvidence.gateBlocksSinceToolProgress, 1);
    assert.equal(
      completionGateDecision(afterGate, repeatedEvidence, afterGate.goal.text ?? '').kind,
      'failed',
      'stopping again without tool progress must be bounded instead of looping forever',
    );

    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES ('completion-test-step', 'completion-run', 'completion-runtime', 4, 'tool', 'completed', 0, '[]', '[]', ?, ?)`,
      [now + 2, now + 2],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, result_json, created_at, started_at, completed_at)
       VALUES ('completion-test', 'completion-run', 'completion-runtime', 'completion-test-step',
               'completion-stop-step', 'provider-test', 'shell_execute', '1.0.0', ?, 'gate-test', 1,
               'mutate', 'succeeded', ?, ?, ?, ?)`,
      [
        inspection(
          'shell_execute',
          {
            target: 'workspace',
            id: 'gate-workspace',
            command: { kind: 'argv', argv: ['pnpm', 'test'] },
            cwd: '/workspace/work',
            timeoutSeconds: 60,
            mode: 'foreground',
          },
          'gate-test',
        ),
        successfulResult('Test command', 'verified', {
          kind: 'execution',
          target: { target: 'workspace', id: 'gate-workspace' },
          status: 'succeeded',
          job: { jobId: 'job-' + 'a'.repeat(64), workspaceId: 'gate-workspace', generation: 1 },
        }),
        now + 2,
        now + 2,
        now + 2,
      ],
    );
    const evidenceAfterTest = await repository.completionEvidence(scope, 'completion-run');
    const completeDecision = completionGateDecision(afterGate, evidenceAfterTest, afterGate.goal.text ?? '');
    assert.deepEqual(completeDecision, {
      kind: 'complete',
      terminalStatus: 'completed',
      summary: 'Verified execution evidence satisfied the requested completion check.',
    });

    const begun = await stateCommit.beginModelStep({
      scope,
      runId: 'completion-run',
      runtimeId: 'completion-runtime',
      expectedRunVersion: afterGate.version,
      inputWatermark: afterGate.inputRevision,
      reservedTokens: 4096,
      estimatedInputTokens: 256,
      reservedOutputTokens: 1024,
      contextWindowTokens: 16_384,
      now: now + 3,
    });
    const settled = await stateCommit.settleModelStep({
      scope,
      runId: 'completion-run',
      runtimeId: 'completion-runtime',
      stepId: begun.stepId,
      attemptId: begun.attemptId,
      expectedRunVersion: begun.run.version,
      assistantEntryId: 'completion-final-answer',
      assistantText: 'Implementation and tests are complete.',
      usage: begun.run.usage,
      inputTokens: 50,
      outputTokens: 15,
      cachedInputTokens: 0,
      estimatedUsage: false,
      finishReason: 'stop',
      verificationSummary: completeDecision.kind === 'complete' ? completeDecision.summary : undefined,
      terminalStatus: completeDecision.kind === 'complete' ? completeDecision.terminalStatus : 'failed',
      now: now + 4,
    });
    assert.equal(settled.run.status, 'completed');
    assert.equal(settled.run.goalStatus, 'satisfied');
    assert.equal(settled.run.verificationStatus, 'verified');
    const verificationEvent = await db.queryOne<{ payload_json: string }>(
      "SELECT payload_json FROM agent_events WHERE run_id = 'completion-run' AND type = 'verification.completed' ORDER BY sequence DESC LIMIT 1",
    );
    assert.equal((JSON.parse(verificationEvent?.payload_json ?? '{}') as { status?: unknown }).status, 'verified');
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }

  return [
    { name: 'premature_completions_blocked', value: 1, unit: 'runs' },
    { name: 'gate_loops_without_progress', value: 0, unit: 'loops' },
    { name: 'verified_completions', value: 1, unit: 'runs' },
  ];
};
