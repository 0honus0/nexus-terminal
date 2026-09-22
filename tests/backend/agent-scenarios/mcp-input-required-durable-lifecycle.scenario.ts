import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { JsonValue } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ToolInspection, ToolResult } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import {
  mcpInputRequestFromToolResult,
  mcpInputResumeForRequest,
} from '../../../packages/backend/src/modules/agent/runtime/runs/mcp-input-required';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import { SCENARIO_MODEL_CAPABILITIES, scope } from './scenario-fixtures';

export const mcpInputRequiredDurableLifecycleScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-mcp-input-required-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'mcp-input-required.sqlite', nodeEnv: 'test' });
  const observedEvents: string[] = [];
  const stateCommit = new SqliteStateCommitAdapter(db, (_run, events) => {
    observedEvents.push(...events.map((event) => event.type));
  });
  const repository = new SqliteRunRepository(db);
  const now = 1_800_200_000;
  const runId = 'mcp-input-run';
  const runtimeId = 'mcp-input-runtime';
  const threadId = 'mcp-input-thread';
  const modelStepId = 'mcp-input-model-step';
  const toolStepId = 'mcp-input-tool-step';
  const toolCallId = 'mcp-input-tool-call';
  const providerCallId = 'mcp-input-provider-call';
  const integrationId = 'mcp-input-integration';
  const schemaHash = 'v1:mcp-input-schema';
  const requestParams: JsonValue = { name: 'lookup', arguments: { query: 'needle' } };
  const inspection: ToolInspection = {
    toolName: 'mcp_input_lookup',
    toolVersion: 'mcp:input-v1',
    normalizedArguments: { query: 'needle' },
    target: {
      kind: 'integration',
      integrationId,
      schemaHash,
      targetIdentity: 'mcp:mcp-input-integration:lookup:v1',
      endpoint: 'https://mcp.example.test/',
      loginUser: 'mcp-client',
      configurationHash: 'mcp-input-config-v1',
    },
    resourceKeys: ['integration:mcp:mcp-input-integration:lookup'],
    risk: 'read',
    mutation: false,
    operationHash: 'mcp-input-operation-v1',
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: 1,
    inputRevision: 1,
  };
  const inputRequiredResult = (requestState: string): ToolResult => ({
    ok: false,
    summary: 'The MCP server requires user input before this request can continue.',
    data: {
      mcpInputRequired: {
        integrationId,
        schemaHash,
        method: 'tools/call',
        requestParams,
        inputRequests: {
          need_token: {
            method: 'elicitation/create',
            params: {
              message: 'Provide the durable scenario token.',
              requestedSchema: {
                type: 'object',
                additionalProperties: false,
                properties: { token: { type: 'string' } },
                required: ['token'],
              },
            },
          },
        },
        requestState,
      },
    },
    artifactRefs: [],
    truncated: false,
    outcome: 'confirmed',
    errorCode: 'MCP_INPUT_REQUIRED',
    verification: {
      status: 'unverified',
      summary: 'Remote MCP request is non-terminal.',
      evidenceRefs: [],
    },
  });

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'mcp-input-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads
        (id, user_id, app_id, title, title_source, next_sequence, created_at, updated_at)
       VALUES (?, 1, 'scenario-app', 'mcp-input-thread', 'manual', 2, ?, ?)`,
      [threadId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, goal_text, goal_revision, goal_updated_at,
         verification_status, budget_json, definition_json, plan_json, usage_json,
         active_execution_started_at, executing_runtime_count, consumed_input_sequence, input_revision,
         created_at, started_at, updated_at)
       VALUES (?, 1, 'scenario-app', ?, 'running', 'in_progress', ?, 1, ?, 'not_started', ?, ?, ?, ?,
               ?, 1, 1, 1, ?, ?, ?)`,
      [
        runId,
        threadId,
        'Complete the MCP lookup after required user input.',
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
        now,
      ],
    );
    await db.execute(
      `INSERT INTO ai_thread_entries
        (id, thread_id, user_id, app_id, run_id, sequence, kind, payload_json, created_at)
       VALUES ('mcp-input-initial', ?, 1, 'scenario-app', ?, 1, 'user_input', ?, ?)`,
      [threadId, runId, JSON.stringify({ text: 'Run the MCP lookup.', artifactRefs: [] }), now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES (?, ?, 'root', 'native', ?, 'running', 'executing', 0, 'owner-mcp-input-runtime', ?, ?)`,
      [
        runtimeId,
        runId,
        JSON.stringify({ providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 }),
        now,
        now,
      ],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES (?, ?, ?, 1, 'model', 'completed', 1, '[]', '[]', ?, ?)`,
      [modelStepId, runId, runtimeId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES (?, ?, ?, 2, 'tool', 'running', 1, '[]', '[]', ?)`,
      [toolStepId, runId, runtimeId, now],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version, inspection_json, operation_hash, operation_hash_version,
         risk, status, created_at, started_at, version)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, 1, 'read', 'running', ?, ?, 1)`,
      [
        toolCallId,
        runId,
        runtimeId,
        toolStepId,
        modelStepId,
        providerCallId,
        inspection.toolName,
        inspection.toolVersion,
        JSON.stringify(inspection),
        inspection.operationHash,
        now,
        now,
      ],
    );

    const firstRequest = mcpInputRequestFromToolResult(inputRequiredResult('opaque-durable-state-1'));
    assert.ok(firstRequest);
    const parked = await stateCommit.parkMcpInputRequiredTool({
      scope,
      runId,
      runtimeId,
      toolStepId,
      toolCallId,
      expectedRunVersion: 1,
      providerCallId,
      requestId: 'mcp-durable-request',
      questions: firstRequest.questions,
      continuation: firstRequest.continuation,
      now: now + 1,
    });
    assert.equal(parked.run.status, 'awaiting_input');
    assert.equal(parked.run.executingRuntimeCount, 0);
    const parkedState = await db.queryOne<{
      tool_status: string;
      step_status: string;
      schedule_state: string;
      request_status: string;
      continuation_json: string | null;
    }>(
      `SELECT t.status AS tool_status, s.status AS step_status, rt.schedule_state,
              ir.status AS request_status, ir.continuation_json
       FROM agent_tool_calls t
       JOIN agent_steps s ON s.id = t.step_id
       JOIN agent_runtimes rt ON rt.id = t.agent_runtime_id
       JOIN agent_input_requests ir ON ir.tool_call_id = t.id
       WHERE t.id = ?`,
      [toolCallId],
    );
    assert.equal(parkedState?.tool_status, 'proposed');
    assert.equal(parkedState?.step_status, 'created');
    assert.equal(parkedState?.schedule_state, 'waiting_message');
    assert.equal(parkedState?.request_status, 'requested');
    assert.ok(parkedState?.continuation_json?.includes('opaque-durable-state-1'));
    const prematureToolResults = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ai_thread_entries
       WHERE run_id = ? AND kind = 'tool_result'`,
      [runId],
    );
    assert.equal(prematureToolResults?.count, 0, 'input_required must not create a fake terminal Tool result');

    const answered = await stateCommit.appendInput({
      scope,
      runId,
      inputEntryId: 'mcp-durable-answer',
      input: { text: 'mcp_1: {"token":"abc"}', artifactRefs: [] },
      mode: 'append',
      expectedRunVersion: parked.run.version,
      idempotencyKey: 'mcp-durable-answer-key',
      requestHash: 'mcp-durable-answer-hash',
      now: now + 2,
    });
    assert.equal(answered.run.status, 'running');
    assert.equal(answered.shouldReschedule, true);
    const continuation = await repository.inputContinuationForTool(scope, runId, toolCallId);
    assert.ok(continuation);
    const resume = mcpInputResumeForRequest(continuation.continuation, continuation.answerText, {
      integrationId,
      schemaHash,
      method: 'tools/call',
      requestParams,
    });
    assert.equal(resume.requestState, 'opaque-durable-state-1');
    assert.deepEqual((resume.inputResponses as Record<string, JsonValue>).need_token, {
      action: 'accept',
      content: { token: 'abc' },
    });
    const answeredRuntime = await db.queryOne<{ schedule_state: string }>(
      'SELECT schedule_state FROM agent_runtimes WHERE id = ?',
      [runtimeId],
    );
    assert.equal(answeredRuntime?.schedule_state, 'runnable');

    const refreshedInspection: ToolInspection = {
      ...inspection,
      operationHash: 'mcp-input-operation-v2',
      inputRevision: answered.run.inputRevision,
    };
    const refreshed = await stateCommit.refreshProposedTool({
      scope,
      runId,
      toolStepId,
      toolCallId,
      expectedRunVersion: answered.run.version,
      inspection: refreshedInspection,
      now: now + 3,
    });
    await db.execute(
      `UPDATE agent_runtimes SET schedule_state = 'executing', updated_at = ?
       WHERE id = ? AND run_id = ? AND schedule_state = 'runnable'`,
      [now + 4, runtimeId, runId],
    );
    await db.execute(
      `UPDATE agent_runs SET executing_runtime_count = 1, active_execution_started_at = ?
       WHERE id = ?`,
      [now + 4, runId],
    );
    const begunAgain = await stateCommit.beginReadToolBatch({
      scope,
      runId,
      runtimeId,
      expectedRunVersion: refreshed.run.version,
      items: [{ toolStepId, toolCallId }],
      now: now + 4,
    });
    const secondRequest = mcpInputRequestFromToolResult(inputRequiredResult('opaque-durable-state-2'));
    assert.ok(secondRequest);
    const parkedAgain = await stateCommit.parkMcpInputRequiredTool({
      scope,
      runId,
      runtimeId,
      toolStepId,
      toolCallId,
      expectedRunVersion: begunAgain.run.version,
      providerCallId,
      requestId: 'mcp-durable-request-round-2',
      questions: secondRequest.questions,
      continuation: secondRequest.continuation,
      now: now + 5,
    });
    assert.equal(parkedAgain.run.status, 'awaiting_input');
    const requestRows = await db.queryAll<{ id: string; status: string; version: number; continuation_json: string }>(
      'SELECT id, status, version, continuation_json FROM agent_input_requests WHERE tool_call_id = ?',
      [toolCallId],
    );
    assert.equal(requestRows.length, 1, 'multi-round input_required must reuse the durable request owner for one Tool');
    assert.equal(requestRows[0]?.id, 'mcp-durable-request');
    assert.equal(requestRows[0]?.status, 'requested');
    assert.ok((requestRows[0]?.version ?? 0) >= 3);
    assert.match(requestRows[0]?.continuation_json ?? '', /opaque-durable-state-2/);
    assert.equal(
      observedEvents.filter((type) => type === 'input.requested').length,
      2,
      'each MCP input_required round must emit exactly one durable input.requested event',
    );

    return [
      { name: 'mcp_input_required_durable_parks', value: 2, unit: 'rounds' },
      { name: 'mcp_input_required_fake_tool_results', value: prematureToolResults?.count ?? 0, unit: 'results' },
      { name: 'mcp_input_required_resume_states', value: 1, unit: 'states' },
      { name: 'mcp_input_required_request_rows', value: requestRows.length, unit: 'rows' },
    ];
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
