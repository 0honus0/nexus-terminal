import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStateCommitAdapter } from '../../../packages/backend/src/infrastructure/agent/runtime/sqlite-state-commit.adapter';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ClockPort, JsonValue } from '../../../packages/backend/src/modules/agent/agent.types';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import {
  projectToolResult,
  ToolExecutor,
} from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import type {
  AgentTool,
  ToolContext,
  ToolResult,
} from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { AppCapabilityBroker } from '../../../packages/backend/src/modules/agent/host/app-capability-broker';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import { SubagentContextBuilder } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent-context-builder';
import type {
  MailboxReaderPort,
  RuntimeParticipantRepositoryPort,
  RuntimeParticipantView,
  RuntimeToolExchangeView,
} from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent.repository.port';
import type { DelegationView } from '../../../packages/backend/src/modules/agent/runtime/collaboration/subagent.types';
import { freezeRunContextPolicy } from '../../../packages/backend/src/modules/agent/runtime/runs/run-budget-policy';
import type { RunView } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';
import { emptyModelContinuations, SCENARIO_MODEL_CAPABILITIES, scope } from './scenario-fixtures';

export const toolResultProjectionScenario = async () => {
  const maxModelBytes = 1_024;
  const rawLog = [
    'HEAD marker: compilation started',
    ...Array.from(
      { length: 900 },
      (_, index) => `noise-${index.toString().padStart(4, '0')} lorem ipsum dolor sit amet`,
    ),
    'ERROR critical failure: unresolved symbol at src/main.ts:42',
    'TAIL marker: process exited with code 1',
  ].join('\n');
  const rawResult: ToolResult = {
    ok: false,
    summary: 'Build failed after producing a large diagnostic log.',
    data: {
      log: rawLog,
      exitCode: 1,
      command: 'pnpm build',
      nested: { status: 'failed', detail: 'diagnostic payload' },
    },
    artifactRefs: ['artifact-raw-log'],
    truncated: false,
    outcome: 'confirmed',
    errorCode: 'BUILD_FAILED',
    verification: {
      status: 'failed',
      summary: 'The build command returned exit code 1.',
      evidenceRefs: ['artifact-build-evidence'],
    },
  };
  const rawBytes = Buffer.byteLength(JSON.stringify(rawResult), 'utf8');
  assert.ok(rawBytes > maxModelBytes * 10, 'fixture must be materially larger than the model-facing budget');

  const catalog = new ToolCatalog();
  const fixtureTool: AgentTool = {
    descriptor: {
      name: 'scenario_large_output',
      version: '1',
      description: 'Return a deliberately large deterministic ToolResult.',
      inputSchema: { type: 'object', additionalProperties: false },
      riskClass: 'read',
    },
    inspect: async (input, context, policyRevision) => ({
      toolName: 'scenario_large_output',
      toolVersion: '1',
      normalizedArguments: input,
      target: {
        kind: 'run',
        targetIdentity: context.runId,
        endpoint: context.runId,
        loginUser: context.agentRuntimeId,
        configurationHash: 'tool-result-projection',
      },
      resourceKeys: ['scenario:tool-result-projection'],
      risk: 'read',
      mutation: false,
      operationHash: 'tool-result-projection',
      operationHashVersion: 1,
      preconditions: [],
      policyRevision,
      inputRevision: context.inputRevision,
    }),
    execute: async () => rawResult,
  };
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.tool-result-projection',
    tools: [fixtureTool],
  });
  const executor = new ToolExecutor(catalog, {
    authorize: async () => ({ allowed: true as const, policyRevision: 1 }),
  } as unknown as AppCapabilityBroker);
  const toolContext: ToolContext = {
    ...scope,
    actor: {
      kind: 'agent',
      userId: scope.userId,
      appId: scope.appId,
      runId: 'tool-result-projection-run',
      agentRuntimeId: 'tool-result-projection-runtime',
    },
    runId: 'tool-result-projection-run',
    agentRuntimeId: 'tool-result-projection-runtime',
    connectionIds: [],
    environment: null,
    stepId: 'tool-result-projection-step',
    signal: new AbortController().signal,
    deadlineAt: 1_900_000_000,
    maxOutputBytes: maxModelBytes,
    inputRevision: 1,
  };
  const inspection = await executor.inspect(toolContext, {
    providerCallId: 'provider-large-output',
    name: 'scenario_large_output',
    argumentsJson: '{}',
  });
  const executed = await executor.execute(toolContext, inspection);
  assert.equal(
    (executed.data as { log?: string } | undefined)?.log,
    rawLog,
    'ToolExecutor must return the raw execution truth; model-facing projection must not destroy durable evidence before StateCommit',
  );

  const projected = projectToolResult(rawResult, maxModelBytes);
  const projectedBytes = Buffer.byteLength(JSON.stringify(projected), 'utf8');
  assert.ok(projectedBytes <= maxModelBytes, 'model-facing ToolResult projection must respect maxToolOutputBytes');
  const projectedEncoded = JSON.stringify(projected);
  assert.match(projectedEncoded, /ERROR critical failure/, 'projection must preserve high-signal error lines');
  assert.match(
    projectedEncoded,
    /TAIL marker/,
    'projection must preserve tail diagnostics instead of prefix-only truncation',
  );
  assert.deepEqual(
    projected.artifactRefs,
    ['artifact-raw-log'],
    'artifactRefs must survive model projection when budget allows',
  );
  const projectionMetadata = projected as ToolResult & {
    projection?: { originalBytes: number; sha256: string };
  };
  assert.equal(projectionMetadata.projection?.originalBytes, rawBytes, 'projection must disclose original byte size');
  assert.match(
    projectionMetadata.projection?.sha256 ?? '',
    /^[a-f0-9]{64}$/,
    'projection must disclose a stable raw hash',
  );

  const runtime: RuntimeParticipantView = {
    id: 'tool-result-child-runtime',
    runId: 'tool-result-child-run',
    participantId: 'child:tool-result-delegation',
    backendKind: 'native',
    modelRef: { providerId: 'scenario-provider', modelId: 'scenario-model', configurationVersion: 1 },
    status: 'running',
    scheduleState: 'runnable',
    consumedMailboxSequence: 0,
  };
  const runtimes = {
    runtime: async () => runtime,
    recentRuntimeToolExchanges: async (): Promise<RuntimeToolExchangeView[]> => [
      {
        sourceModelStepId: 'tool-result-child-model-step',
        batchIndex: 0,
        batchSize: 1,
        providerCallId: 'provider-child-large-output',
        toolName: 'scenario_large_output',
        arguments: {},
        result: rawResult as unknown as JsonValue,
        status: 'failed',
      },
    ],
  } as unknown as RuntimeParticipantRepositoryPort;
  const childBuilder = new SubagentContextBuilder(
    runtimes,
    { readMessages: async () => [], listDelegationMessages: async () => [] } as MailboxReaderPort,
    { discover: () => [] } as unknown as ToolCatalog,
    new CapabilityRegistry(),
    emptyModelContinuations,
    null!,
    { nowUnixSeconds: () => 1_800_000_000 } as ClockPort,
  );
  const delegation = {
    id: 'tool-result-delegation',
    runId: 'tool-result-child-run',
    parentRuntimeId: 'root-runtime',
    childRuntimeId: runtime.id,
    profileId: 'default',
    grants: [],
    peerMessaging: 'parent-child',
    mutationMode: 'read-only',
    modelRef: runtime.modelRef,
    objective: 'Inspect a build failure.',
    constraints: [],
    inputArtifactRefs: [],
    completionCriteria: [],
    dependencyMode: 'settled',
    status: 'running',
    depth: 1,
    failureMode: 'isolate',
    budget: { maxSteps: 8 },
    usage: { tokens: 0, steps: 0 },
    result: null,
    evidenceRefs: [],
    deadlineAt: 1_900_000_000,
    version: 1,
    createdAt: 1_800_000_000,
    updatedAt: 1_800_000_000,
    completedAt: null,
    ...scope,
  } satisfies DelegationView;
  const childRun = {
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      steps: 0,
      subagentMessages: 0,
      subagentMessageBytes: 0,
    },
    budget: { maxRunSteps: 32, maxToolOutputBytes: maxModelBytes, contextPolicy: freezeRunContextPolicy('normal') },
    definition: { environment: null },
  } as unknown as RunView;
  const childPrepared = await childBuilder.prepare(
    scope,
    'tool-result-child-run',
    runtime.id,
    delegation,
    {
      id: 'scenario-model',
      contextWindow: 32_768,
      maxOutputTokens: 2_048,
      supportsTools: true,
      supportsImageInput: false,
      supportsFileInput: false,
    },
    childRun,
  );
  assert.equal(childPrepared.kind, 'ready');
  if (childPrepared.kind !== 'ready') throw new Error('SCENARIO_INVALID');
  const childToolMessage = childPrepared.plan.messages.find(
    (message) => message.role === 'tool' && message.toolCallId === 'provider-child-large-output',
  );
  assert.ok(childToolMessage, 'Subagent context must retain the completed Tool exchange');
  assert.ok(
    Buffer.byteLength(childToolMessage.content, 'utf8') <= maxModelBytes,
    'Subagent ToolResult projection must use the same model-facing byte budget instead of a separate 8 KiB rule',
  );
  assert.match(
    childToolMessage.content,
    /ERROR critical failure/,
    'Subagent projection must preserve high-signal errors',
  );
  assert.match(childToolMessage.content, /TAIL marker/, 'Subagent projection must preserve tail diagnostics');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-tool-result-projection-'));
  const db = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'tool-result-projection.sqlite',
    nodeEnv: 'test',
  });
  const stateCommit = new SqliteStateCommitAdapter(db);
  const now = 1_801_060_000;
  const budget = JSON.stringify({
    maxRunSteps: 32,
    maxActiveExecutionSeconds: 3_600,
    toolTimeoutSeconds: 120,
    maxToolOutputBytes: maxModelBytes,
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
  const usage = JSON.stringify({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    steps: 0,
    subagentMessages: 0,
    subagentMessageBytes: 0,
  });
  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'tool-result-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES ('tool-result-thread', 1, 'scenario-app', 'tool result projection', 'manual', ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES ('tool-result-run', 1, 'scenario-app', 'tool-result-thread', 'running', 'in_progress', 'not_started',
               ?, ?, '{"schemaVersion":1,"revision":0,"items":[]}', ?, 1, ?, ?, ?)`,
      [budget, definition, usage, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runtimes
        (id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state,
         consumed_mailbox_sequence, execution_owner_id, created_at, updated_at)
       VALUES ('tool-result-runtime', 'tool-result-run', 'root', 'native', ?,
               'running', 'executing', 0, 'tool-result-owner', ?, ?)`,
      [JSON.stringify(runtime.modelRef), now, now],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES ('tool-result-model-step', 'tool-result-run', 'tool-result-runtime', 1,
               'model', 'completed', 0, '[]', '[]', ?, ?)`,
      [now, now],
    );
    await db.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at)
       VALUES ('tool-result-step', 'tool-result-run', 'tool-result-runtime', 2,
               'tool', 'created', 0, '[]', '[]', ?)`,
      [now],
    );
    await db.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version, inspection_json, operation_hash,
         operation_hash_version, risk, status, created_at)
       VALUES ('tool-result-call', 'tool-result-run', 'tool-result-runtime', 'tool-result-step',
               'tool-result-model-step', 0, 1, 'provider-root-large-output', 'scenario_large_output', '1',
               '{}', 'tool-result-hash', 1, 'read', 'proposed', ?)`,
      [now],
    );
    const begun = await stateCommit.beginReadToolBatch({
      scope,
      runId: 'tool-result-run',
      runtimeId: 'tool-result-runtime',
      expectedRunVersion: 1,
      items: [{ toolStepId: 'tool-result-step', toolCallId: 'tool-result-call' }],
      now: now + 1,
    });
    await stateCommit.settleReadToolBatch({
      scope,
      runId: 'tool-result-run',
      runtimeId: 'tool-result-runtime',
      expectedRunVersion: begun.run.version,
      items: [
        {
          toolStepId: 'tool-result-step',
          toolCallId: 'tool-result-call',
          toolResultEntryId: 'tool-result-ledger-entry',
          providerCallId: 'provider-root-large-output',
          result: rawResult,
        },
      ],
      now: now + 2,
    });
    const stored = await db.queryOne<{ result_json: string }>(
      "SELECT result_json FROM agent_tool_calls WHERE id = 'tool-result-call'",
    );
    assert.ok(stored?.result_json);
    assert.equal(
      (JSON.parse(stored!.result_json) as { data?: { log?: string } }).data?.log,
      rawLog,
      'agent_tool_calls.result_json must retain raw Tool evidence',
    );
    const ledger = await db.queryOne<{ payload_json: string }>(
      "SELECT payload_json FROM ai_thread_entries WHERE id = 'tool-result-ledger-entry'",
    );
    assert.ok(ledger?.payload_json);
    const ledgerPayload = JSON.parse(ledger!.payload_json) as { text?: string };
    assert.equal(typeof ledgerPayload.text, 'string');
    assert.ok(
      Buffer.byteLength(ledgerPayload.text!, 'utf8') <= maxModelBytes,
      'Ledger tool_result must store the bounded model-facing projection, not the raw result',
    );
    assert.match(ledgerPayload.text!, /ERROR critical failure/);
    assert.match(ledgerPayload.text!, /TAIL marker/);
    assert.ok(!ledgerPayload.text!.includes('noise-0899'), 'projection must not serialize the entire raw log');

    return [
      { name: 'raw_result_bytes', value: rawBytes, unit: 'bytes' },
      { name: 'projected_result_bytes', value: projectedBytes, unit: 'bytes' },
      { name: 'root_ledger_bytes', value: Buffer.byteLength(ledgerPayload.text!, 'utf8'), unit: 'bytes' },
      { name: 'subagent_tool_result_bytes', value: Buffer.byteLength(childToolMessage.content, 'utf8'), unit: 'bytes' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
