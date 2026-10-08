import type { Scope } from '../../../../modules/agent/agent.types';
import type { StateCommitResult } from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RunBudget } from '../../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
import { parseRunBudget, parseRunUsage } from '../durable-state-decoders';
import { allocateHostEvent, appendEvents, patchRun, summaryPayload } from './transaction-primitives';

export interface AdvanceExecutionBudgetCommand {
  scope: Scope;
  runId: string;
  now: number;
}

const activeSeconds = (row: RunRow, now: number): number =>
  row.active_execution_seconds +
  (row.active_execution_started_at === null ? 0 : Math.max(0, now - row.active_execution_started_at));

/** Called inside the same transaction as admission. Reservations are never refunded on failure. */
export const assertModelAdmission = (row: RunRow, now: number, child = false): void => {
  const budget = parseRunBudget(row.budget_json);
  const usage = parseRunUsage(row.usage_json);
  const reserve = child ? Math.min(2, Math.max(0, budget.modelRequestCeiling - 1)) : 0;
  if (
    (child && budget.phase === 'finishing') ||
    usage.modelRequests >= Math.min(budget.maxModelRequests, budget.modelRequestCeiling) - reserve ||
    activeSeconds(row, now) >= budget.activeExecutionCeilingSeconds
  )
    throw new Error('RUN_BUDGET_EXCEEDED');
};

export const reserveToolExecutions = async (
  tx: RelationalDatabase,
  row: RunRow,
  count: number,
  now: number,
): Promise<void> => {
  const budget = parseRunBudget(row.budget_json);
  const usage = parseRunUsage(row.usage_json);
  if (
    budget.phase === 'finishing' ||
    usage.toolExecutions + count > budget.maxToolExecutions ||
    activeSeconds(row, now) >= budget.activeExecutionCeilingSeconds
  )
    throw new Error('RUN_BUDGET_EXCEEDED');
  const next = { ...usage, toolExecutions: usage.toolExecutions + count };
  await tx.execute('UPDATE agent_runs SET usage_json = ? WHERE id = ?', [JSON.stringify(next), row.id]);
  row.usage_json = JSON.stringify(next);
};

/** Progress is a new successful observation with data or verification evidence, not a Plan edit.
 * Identical action/results and previously consumed event windows cannot fund another extension.
 * This is deliberately a bounded heuristic; the frozen ceilings remain the safety boundary.
 */
export const advanceExecutionBudgetTransition = async (
  tx: RelationalDatabase,
  command: AdvanceExecutionBudgetCommand,
): Promise<StateCommitResult> => {
  const row = await tx.queryOne<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [command.runId, command.scope.userId, command.scope.appId],
  );
  if (!row) throw new Error('NOT_FOUND');
  const budget = parseRunBudget(row.budget_json);
  const usage = parseRunUsage(row.usage_json);
  const unchanged = (): StateCommitResult => ({
    run: mapRunRow(row),
    eventCursor: row.next_event_sequence - 1,
    ledgerCursor: 0,
    committedEvents: [],
  });
  if (!['created', 'running'].includes(row.status) || budget.phase === 'finishing') return unchanged();
  const seconds = activeSeconds(row, command.now);
  const requestReserve = Math.min(2, Math.max(0, budget.modelRequestCeiling - 1));
  const timeReserve = Math.min(30, Math.floor(budget.activeExecutionCeilingSeconds / 10));
  const softReserve = Math.min(requestReserve, Math.max(1, Math.floor(budget.maxModelRequests / 4)));
  const requestPressure = usage.modelRequests >= Math.max(0, budget.maxModelRequests - softReserve);
  const timePressure = seconds >= Math.max(0, budget.maxActiveExecutionSeconds - timeReserve);
  const reason: RunBudget['stopReason'] =
    usage.toolExecutions >= budget.maxToolExecutions
      ? 'tool_execution_limit'
      : usage.modelRequests >= budget.modelRequestCeiling - requestReserve
        ? 'model_request_limit'
        : seconds >= budget.activeExecutionCeilingSeconds - timeReserve
          ? 'active_time_limit'
          : null;
  if (!reason && !requestPressure && !timePressure) return unchanged();

  const guard = await tx.queryOne<{ warning_level: number; no_progress_count: number }>(
    'SELECT warning_level, no_progress_count FROM agent_loop_guards WHERE run_id = ?',
    [row.id],
  );
  const recent = await tx.queryAll<{ sequence: number; status: string; novel: number }>(
    `SELECT e.sequence, t.status,
      CASE WHEN t.status = 'succeeded' AND
        (json_extract(t.result_json, '$.data') IS NOT NULL OR
         json_array_length(t.result_json, '$.verification.evidenceRefs') > 0 OR
         json_array_length(t.result_json, '$.artifactRefs') > 0) AND
        NOT EXISTS (SELECT 1 FROM agent_tool_calls previous
          WHERE previous.run_id = t.run_id AND previous.id <> t.id AND
            previous.completed_at IS NOT NULL AND
            (previous.completed_at < t.completed_at OR
              (previous.completed_at = t.completed_at AND previous.rowid < t.rowid)) AND
            previous.operation_hash = t.operation_hash AND
            json_extract(previous.result_json, '$.data') IS json_extract(t.result_json, '$.data') AND
            json_extract(previous.result_json, '$.verification') IS json_extract(t.result_json, '$.verification'))
      THEN 1 ELSE 0 END AS novel
     FROM agent_events e JOIN agent_tool_calls t ON t.id = json_extract(e.payload_json, '$.toolCallId')
     WHERE e.run_id = ? AND e.sequence > ? AND e.type IN ('tool.completed','tool.failed')
     ORDER BY e.sequence DESC LIMIT 32`,
    [row.id, budget.progressSequence],
  );
  const persistentFailure = recent.length >= 3 && recent.slice(0, 3).every((item) => item.status !== 'succeeded');
  const progress = recent.some((item) => item.novel === 1);
  const extend = !reason && progress && !persistentFailure && (!guard || guard.warning_level === 0);
  const grow = (current: number, ceiling: number): number =>
    Math.min(ceiling, Math.max(current + 1, Math.ceil(current * 1.5)));
  const next: RunBudget = extend
    ? {
        ...budget,
        maxModelRequests: requestPressure
          ? grow(budget.maxModelRequests, budget.modelRequestCeiling)
          : budget.maxModelRequests,
        maxActiveExecutionSeconds: timePressure
          ? grow(budget.maxActiveExecutionSeconds, budget.activeExecutionCeilingSeconds)
          : budget.maxActiveExecutionSeconds,
        extensionCount: budget.extensionCount + 1,
        progressSequence: row.next_event_sequence - 1,
        revision: budget.revision + 1,
      }
    : { ...budget, phase: 'finishing', stopReason: reason ?? 'no_progress', revision: budget.revision + 1 };
  const events = [
    {
      type: extend ? ('budget.auto_extended' as const) : ('budget.finishing' as const),
      payload: {
        reason: extend ? 'new_execution_evidence' : next.stopReason,
        previousModelRequests: budget.maxModelRequests,
        maxModelRequests: next.maxModelRequests,
        previousActiveExecutionSeconds: budget.maxActiveExecutionSeconds,
        maxActiveExecutionSeconds: next.maxActiveExecutionSeconds,
        usedModelRequests: usage.modelRequests,
        usedToolExecutions: usage.toolExecutions,
        progressSequence: next.progressSequence,
        extensionCount: next.extensionCount,
      },
    },
  ];
  const committedEvents = await appendEvents(tx, row, events, command.now);
  const updated = await patchRun(tx, row, { budget: next }, events.length, command.now);
  const run = mapRunRow(updated);
  await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), command.now);
  return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
};
