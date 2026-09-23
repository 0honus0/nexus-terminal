import { randomUUID } from 'node:crypto';
import type { ToolResult } from '../../../../modules/agent/capabilities/tool.types';
import type {
  CommitToolProposalBatchCommand,
  CommitToolProposalBatchResult,
  DurableEventInput,
  RefreshProposedToolCommand,
  RejectProposedToolCommand,
  StateCommitResult,
} from '../../../../modules/agent/runtime/runs/state-commit.port';
import { encodeModelProviderContinuation } from '../../../../modules/agent/ai/model-continuation';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS } from '../../repositories/sqlite-run.mapper';
import type { RunRow } from '../../repositories/sqlite-run.mapper';
import {
  allocateHostEvent,
  appendEvents,
  appendLedger,
  patchRun,
  summaryPayload,
  usageWithDelta,
  usageWithProviderContext,
} from './transaction-primitives';
import { toolResultLedgerPayload } from './tool-transition-result';

export const refreshProposedToolTransition = async (
  tx: RelationalDatabase,
  command: RefreshProposedToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (row.input_revision !== command.inspection.inputRevision) throw new Error('INPUT_REVISION_CONFLICT');
  const tool = await tx.queryOne<{ status: string; tool_name: string; tool_version: string; version: number }>(
    `SELECT status, tool_name, tool_version, version FROM agent_tool_calls
     WHERE id = ? AND run_id = ? AND step_id = ?`,
    [command.toolCallId, row.id, command.toolStepId],
  );
  if (
    !tool ||
    tool.status !== 'proposed' ||
    tool.tool_name !== command.inspection.toolName ||
    tool.tool_version !== command.inspection.toolVersion
  ) {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  const changed = await tx.execute(
    `UPDATE agent_tool_calls
     SET inspection_json = ?, operation_hash = ?, risk = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'proposed' AND version = ?`,
    [
      JSON.stringify(command.inspection),
      command.inspection.operationHash,
      command.inspection.risk,
      command.toolCallId,
      row.id,
      tool.version,
    ],
  );
  if (changed.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  const events: DurableEventInput[] = [
    {
      type: 'tool.reinspected',
      payload: {
        toolCallId: command.toolCallId,
        toolStepId: command.toolStepId,
        operationHash: command.inspection.operationHash,
        risk: command.inspection.risk,
      },
    },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const updatedRow = await patchRun(tx, row, {}, events.length, command.now);
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};

export const rejectProposedToolTransition = async (
  tx: RelationalDatabase,
  command: RejectProposedToolCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion || row.status !== 'running') throw new Error('STATE_CONFLICT');
  if (command.result.outcome !== 'confirmed' || command.result.ok) throw new Error('TOOL_RESULT_INVALID');
  const tool = await tx.queryOne<{ status: string; provider_call_id: string; version: number }>(
    `SELECT status, provider_call_id, version FROM agent_tool_calls
     WHERE id = ? AND run_id = ? AND step_id = ?`,
    [command.toolCallId, row.id, command.toolStepId],
  );
  if (!tool || tool.status !== 'proposed' || tool.provider_call_id !== command.providerCallId) {
    throw new Error('TOOL_STATE_CONFLICT');
  }
  const safeResult = JSON.parse(JSON.stringify(command.result)) as ToolResult;
  const toolChanged = await tx.execute(
    `UPDATE agent_tool_calls SET status = 'failed', result_json = ?, completed_at = ?, version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'proposed' AND version = ?`,
    [JSON.stringify(safeResult), command.now, command.toolCallId, row.id, tool.version],
  );
  const stepChanged = await tx.execute(
    `UPDATE agent_steps SET status = 'failed', completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'created'`,
    [command.now, command.toolStepId, row.id],
  );
  if (toolChanged.changes !== 1 || stepChanged.changes !== 1) throw new Error('TOOL_STATE_CONFLICT');
  const ledgerCursor = await appendLedger(
    tx,
    row,
    [
      {
        id: randomUUID(),
        runId: row.id,
        kind: 'tool_result',
        payload: toolResultLedgerPayload(row, safeResult, command.providerCallId),
      },
    ],
    command.now,
  );
  const events: DurableEventInput[] = [
    {
      type: 'tool.failed',
      payload: {
        toolCallId: command.toolCallId,
        toolStepId: command.toolStepId,
        errorCode: command.result.errorCode ?? 'TOOL_REJECTED',
        summary: command.result.summary,
      },
    },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const updatedRow = await patchRun(tx, row, {}, events.length, command.now);
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
};

export const commitToolProposalBatchTransition = async (
  tx: RelationalDatabase,
  command: CommitToolProposalBatchCommand,
): Promise<CommitToolProposalBatchResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  if (row.version < command.expectedRunVersion) throw new Error('STATE_CONFLICT');
  if (row.status !== 'running') throw new Error('RUN_NOT_SETTLEABLE');
  if (command.items.length < 1 || command.items.length > 64) throw new Error('VALIDATION_FAILED');
  if (new Set(command.items.map((item) => item.providerCallId)).size !== command.items.length) {
    throw new Error('MODEL_TOOL_CALL_INVALID');
  }
  if (new Set(command.items.map((item) => item.toolCallId)).size !== command.items.length) {
    throw new Error('MODEL_TOOL_CALL_INVALID');
  }
  if (command.items.some((item) => item.inspection.inputRevision !== row.input_revision)) {
    throw new Error('INPUT_REVISION_CONFLICT');
  }
  const step = await tx.queryOne<{ status: string }>(
    'SELECT status FROM agent_steps WHERE id = ? AND run_id = ? AND agent_runtime_id = ?',
    [command.modelStepId, command.runId, command.runtimeId],
  );
  if (!step || step.status !== 'running') throw new Error('STEP_STATE_CONFLICT');
  const attempt = await tx.queryOne<{ status: string }>(
    `SELECT a.status FROM agent_model_attempts a JOIN agent_steps s ON s.id = a.step_id
     WHERE a.id = ? AND a.step_id = ? AND s.run_id = ?`,
    [command.attemptId, command.modelStepId, command.runId],
  );
  if (!attempt || attempt.status !== 'streaming') throw new Error('ATTEMPT_STATE_CONFLICT');

  await tx.execute(
    `UPDATE agent_model_attempts SET status = 'completed', input_tokens = ?, output_tokens = ?,
       cached_input_tokens = ?, estimated = ?, continuation_json = ?, completed_at = ?
     WHERE id = ? AND status = 'streaming'`,
    [
      command.inputTokens ?? null,
      command.outputTokens ?? null,
      command.cachedInputTokens ?? null,
      command.estimatedUsage ? 1 : 0,
      command.providerContinuation ? encodeModelProviderContinuation(command.providerContinuation) : null,
      command.now,
      command.attemptId,
    ],
  );
  await tx.execute(
    `UPDATE agent_steps SET status = 'completed', completed_at = ?
     WHERE id = ? AND run_id = ? AND status = 'running'`,
    [command.now, command.modelStepId, command.runId],
  );

  const previous = await tx.queryOne<{ max_index: number | null }>(
    'SELECT MAX(step_index) AS max_index FROM agent_steps WHERE run_id = ?',
    [command.runId],
  );
  const resultItems: CommitToolProposalBatchResult['items'] = [];
  const firstToolStepIndex = (previous?.max_index ?? 0) + 1;
  for (const [index, item] of command.items.entries()) {
    const toolStepId = randomUUID();
    await tx.execute(
      `INSERT INTO agent_steps
        (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark,
         input_refs_json, output_refs_json, created_at, completed_at)
       VALUES (?, ?, ?, ?, 'tool', ?, ?, '[]', '[]', ?, ?)`,
      [
        toolStepId,
        command.runId,
        command.runtimeId,
        firstToolStepIndex + index,
        'created',
        row.input_revision,
        command.now,
        null,
      ],
    );
    await tx.execute(
      `INSERT INTO agent_tool_calls
        (id, run_id, agent_runtime_id, step_id, source_model_step_id, batch_index, batch_size,
         provider_call_id, tool_name, tool_version,
         inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
         created_at, started_at, completed_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, ?, 1)`,
      [
        item.toolCallId,
        command.runId,
        command.runtimeId,
        toolStepId,
        command.modelStepId,
        index,
        command.items.length,
        item.providerCallId,
        item.toolName,
        item.toolVersion,
        JSON.stringify(item.inspection),
        item.inspection.operationHash,
        item.inspection.risk,
        'proposed',
        null,
        command.now,
        null,
      ],
    );
    resultItems.push({ providerCallId: item.providerCallId, toolCallId: item.toolCallId, toolStepId });
  }

  const ledgerCursor = await appendLedger(
    tx,
    row,
    [
      {
        id: command.assistantEntryId,
        runId: command.runId,
        kind: 'assistant_message',
        payload: {
          modelStepId: command.modelStepId,
          text: command.assistantText,
          toolCalls: command.items.map((item) => ({
            id: item.providerCallId,
            name: item.modelToolName ?? item.toolName,
            argumentsJson: item.modelArgumentsJson ?? item.argumentsJson,
          })),
        },
      },
    ],
    command.now,
  );
  const events: DurableEventInput[] = [
    {
      type: 'model.completed',
      payload: {
        stepId: command.modelStepId,
        attemptId: command.attemptId,
        finishReason: command.finishReason ?? 'tool-calls',
        inputTokens: command.inputTokens ?? null,
        outputTokens: command.outputTokens ?? null,
      },
    },
  ];
  for (const [index, item] of command.items.entries()) {
    const resultItem = resultItems[index]!;
    events.push({
      type: 'tool.proposed',
      payload: {
        toolCallId: item.toolCallId,
        providerCallId: item.providerCallId,
        toolStepId: resultItem.toolStepId,
        toolName: item.toolName,
        operationHash: item.inspection.operationHash,
        risk: item.inspection.risk,
        batchIndex: index,
        batchSize: command.items.length,
      },
    });
  }
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const mergedUsage = usageWithProviderContext(
    usageWithDelta(row, {
      inputTokens: command.inputTokens,
      outputTokens: command.outputTokens,
      cachedInputTokens: command.cachedInputTokens,
      steps: 1,
    }),
    command.inputTokens,
    command.estimatedUsage,
    command.now,
  );
  const updatedRow = await patchRun(tx, row, { usage: mergedUsage }, events.length, command.now);
  const run = mapRunRow(updatedRow);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return {
    run,
    eventCursor: run.eventCursor,
    ledgerCursor,
    committedEvents,
    items: resultItems,
  };
};
