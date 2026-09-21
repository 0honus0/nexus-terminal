import { createHash, randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../../modules/agent/agent.types';
import type { ToolResult } from '../../../../modules/agent/capabilities/tool.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import type { RunRow } from '../../repositories/sqlite-run.mapper';
import { allocateHostEvent, appendEvents, appendLedger, summaryPayload } from './transaction-primitives';
import { mapRunRow, RUN_COLUMNS } from '../../repositories/sqlite-run.mapper';

interface GuardObservation {
  actionHash: string;
  outcomeHash: string;
  ok: boolean;
  toolName: string;
  risk: 'read' | 'control' | 'mutate' | 'destructive' | 'forbidden';
}

interface GuardRow {
  epoch: number;
  trajectory_json: string;
  no_progress_count: number;
  warning_level: number;
  paused_runtime_id: string | null;
  paused_delegation_id: string | null;
  last_reason: string | null;
}

export interface LoopGuardToolObservation {
  toolName: string;
  risk: GuardObservation['risk'];
  operationHash: string;
  result: ToolResult;
}

export interface LoopGuardDecision {
  run: ReturnType<typeof mapRunRow>;
  eventCursor: number;
  ledgerCursor: number;
  committedEvents: Awaited<ReturnType<typeof appendEvents>>;
  warningLevel: 0 | 1 | 2;
  paused: boolean;
  reason: string | null;
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
};

const hash = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex');

const outcomeHash = (result: ToolResult): string =>
  hash({
    ok: result.ok,
    outcome: result.outcome,
    errorCode: result.errorCode ?? null,
    summary: result.summary,
    data: result.data,
    artifactRefs: result.artifactRefs,
    truncated: result.truncated,
    verification: result.verification,
  });

const sameObservation = (left: GuardObservation, right: GuardObservation): boolean =>
  left.actionHash === right.actionHash && left.outcomeHash === right.outcomeHash;

const suffixCount = (trajectory: GuardObservation[], current: GuardObservation): number => {
  let count = 0;
  for (let index = trajectory.length - 1; index >= 0; index -= 1) {
    if (!sameObservation(trajectory[index]!, current)) break;
    count += 1;
  }
  return count;
};

const occurrenceCount = (trajectory: GuardObservation[], current: GuardObservation): number =>
  trajectory.reduce((count, item) => count + (sameObservation(item, current) ? 1 : 0), 0);

const alternatingSuffix = (trajectory: GuardObservation[]): number => {
  if (trajectory.length < 4) return 0;
  let count = 2;
  for (let index = trajectory.length - 3; index >= 0; index -= 1) {
    if (!sameObservation(trajectory[index]!, trajectory[index + 2]!)) break;
    if (sameObservation(trajectory[index]!, trajectory[index + 1]!)) break;
    count += 1;
  }
  return count;
};

const parseTrajectory = (value: string): GuardObservation[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    )
    .flatMap((item) => {
      if (
        typeof item.actionHash !== 'string' ||
        typeof item.outcomeHash !== 'string' ||
        typeof item.ok !== 'boolean' ||
        typeof item.toolName !== 'string' ||
        !['read', 'control', 'mutate', 'destructive', 'forbidden'].includes(String(item.risk))
      ) {
        return [];
      }
      return [
        {
          actionHash: item.actionHash,
          outcomeHash: item.outcomeHash,
          ok: item.ok,
          toolName: item.toolName,
          risk: item.risk as GuardObservation['risk'],
        },
      ];
    });
};

const noticeText = (level: 1 | 2, reason: string): string =>
  level === 1
    ? `Loop guard: repeated no-progress behavior detected (${reason}). Change strategy, evidence source, or wait for authoritative state change before repeating the same action.`
    : `Loop guard: the current strategy is still repeating without meaningful progress (${reason}). Do not repeat the same action/result pattern; choose a different approach or request user input.`;

export const resetLoopGuard = async (tx: RelationalDatabase, runId: string, now: number): Promise<void> => {
  await tx.execute(
    `INSERT INTO agent_loop_guards
      (run_id, epoch, trajectory_json, no_progress_count, warning_level, paused_runtime_id,
       paused_delegation_id, last_reason, updated_at)
     VALUES (?, 1, '[]', 0, 0, NULL, NULL, NULL, ?)
     ON CONFLICT(run_id) DO UPDATE SET
       epoch = agent_loop_guards.epoch + 1,
       trajectory_json = '[]',
       no_progress_count = 0,
       warning_level = 0,
       paused_runtime_id = NULL,
       paused_delegation_id = NULL,
       last_reason = NULL,
       updated_at = excluded.updated_at`,
    [runId, now],
  );
};

export const evaluateLoopGuard = async (
  tx: RelationalDatabase,
  row: RunRow,
  runtimeId: string,
  delegationId: string | null,
  observations: LoopGuardToolObservation[],
  now: number,
): Promise<LoopGuardDecision> => {
  let state = await tx.queryOne<GuardRow>(
    `SELECT epoch, trajectory_json, no_progress_count, warning_level, paused_runtime_id,
            paused_delegation_id, last_reason
     FROM agent_loop_guards WHERE run_id = ?`,
    [row.id],
  );
  if (!state) {
    await tx.execute(
      `INSERT INTO agent_loop_guards
        (run_id, epoch, trajectory_json, no_progress_count, warning_level, paused_runtime_id,
         paused_delegation_id, last_reason, updated_at)
       VALUES (?, 1, '[]', 0, 0, NULL, NULL, NULL, ?)`,
      [row.id, now],
    );
    state = {
      epoch: 1,
      trajectory_json: '[]',
      no_progress_count: 0,
      warning_level: 0,
      paused_runtime_id: null,
      paused_delegation_id: null,
      last_reason: null,
    };
  }

  let trajectory = parseTrajectory(state.trajectory_json);
  let noProgressCount = state.no_progress_count;
  let warningLevel: 0 | 1 | 2 = state.warning_level === 2 ? 2 : state.warning_level === 1 ? 1 : 0;
  let nextLevel: 0 | 1 | 2 = warningLevel;
  let pause = false;
  let reason: string | null = state.last_reason;

  for (const item of observations) {
    const current: GuardObservation = {
      actionHash: item.operationHash,
      outcomeHash: outcomeHash(item.result),
      ok: item.result.ok,
      toolName: item.toolName,
      risk: item.risk,
    };
    const previous = trajectory.at(-1);
    const exactBefore = previous && sameObservation(previous, current);
    const positiveStateChange =
      (!exactBefore &&
        (item.risk === 'mutate' || item.risk === 'destructive') &&
        item.result.ok &&
        item.result.outcome === 'confirmed') ||
      (!exactBefore && (item.result.artifactRefs.length > 0 || item.result.verification.evidenceRefs.length > 0)) ||
      (previous?.actionHash === current.actionHash && previous.outcomeHash !== current.outcomeHash);

    if (positiveStateChange) {
      // Preserve bounded observation history even across successful mutations. Otherwise an
      // alternating stable read + slightly different mutation sequence can erase the repeated
      // read evidence on every cycle and evade the loop guard indefinitely.
      trajectory = [...trajectory, current].slice(-24);
      noProgressCount = 0;
      warningLevel = 0;
      nextLevel = 0;
      reason = null;
      continue;
    }

    trajectory = [...trajectory, current].slice(-24);
    noProgressCount += 1;
    const exact = suffixCount(trajectory, current);
    const occurrences = occurrenceCount(trajectory, current);
    const alternating = alternatingSuffix(trajectory);

    let candidateLevel: 0 | 1 | 2 = 0;
    let candidatePause = false;
    let candidateReason: string | null = null;
    if (!current.ok && exact >= 2) {
      candidateLevel = exact >= 3 ? 2 : 1;
      candidatePause = exact >= 4;
      candidateReason = 'exact_failure_replay';
    } else if (current.ok && exact >= 3) {
      candidateLevel = exact >= 4 ? 2 : 1;
      candidatePause = exact >= 5;
      candidateReason = 'same_action_same_result';
    } else if ((current.risk === 'read' || current.risk === 'control') && current.ok && occurrences >= 3) {
      candidateLevel = occurrences >= 4 ? 2 : 1;
      candidatePause = occurrences >= 5;
      candidateReason = 'repeated_stable_observation';
    } else if (alternating >= 4) {
      candidateLevel = alternating >= 6 ? 2 : 1;
      candidatePause = alternating >= 8;
      candidateReason = 'oscillation';
    } else if (noProgressCount >= 12) {
      candidateLevel = noProgressCount >= 18 ? 2 : 1;
      candidatePause = noProgressCount >= 24;
      candidateReason = 'long_window_no_progress';
    }
    if (candidateLevel > nextLevel) nextLevel = candidateLevel;
    if (candidateReason) reason = candidateReason;
    if (candidatePause) pause = true;
  }

  await tx.execute(
    `UPDATE agent_loop_guards SET trajectory_json = ?, no_progress_count = ?, warning_level = ?,
       paused_runtime_id = ?, paused_delegation_id = ?, last_reason = ?, updated_at = ?
     WHERE run_id = ?`,
    [
      JSON.stringify(trajectory),
      noProgressCount,
      nextLevel,
      pause ? runtimeId : null,
      pause ? delegationId : null,
      reason,
      now,
      row.id,
    ],
  );

  const newWarning = !pause && nextLevel > warningLevel ? nextLevel : 0;
  const ledgerAppends = [];
  const events = [];
  if (newWarning > 0 && reason) {
    ledgerAppends.push({
      id: randomUUID(),
      runId: row.id,
      kind: 'system_notice' as const,
      payload: { kind: 'loop_guard', text: noticeText(newWarning === 2 ? 2 : 1, reason) } satisfies JsonValue,
    });
    events.push({ type: 'run.loop_warning', payload: { level: newWarning, reason, runtimeId, delegationId } });
  }
  if (pause && reason) {
    ledgerAppends.push({
      id: randomUUID(),
      runId: row.id,
      kind: 'system_notice' as const,
      payload: {
        kind: 'loop_guard',
        text: `Loop guard paused execution after repeated no-progress behavior (${reason}). Wait for new state or ask the user for guidance before continuing.`,
      } satisfies JsonValue,
    });
    events.push(
      { type: 'run.loop_detected', payload: { reason, runtimeId, delegationId } },
      { type: 'run.status_changed', payload: { from: row.status, to: 'awaiting_input' } },
    );
  }

  let ledgerCursor = 0;
  if (ledgerAppends.length > 0) ledgerCursor = await appendLedger(tx, row, ledgerAppends, now);
  const committedEvents = events.length > 0 ? await appendEvents(tx, row, events, now) : [];

  if (pause) {
    const runtime = await tx.queryOne<{ schedule_state: string }>(
      'SELECT schedule_state FROM agent_runtimes WHERE id = ? AND run_id = ?',
      [runtimeId, row.id],
    );
    if (!runtime) throw new Error('RUNTIME_NOT_FOUND');
    if (runtime.schedule_state === 'executing' || runtime.schedule_state === 'runnable') {
      await tx.execute(
        `UPDATE agent_runtimes SET schedule_state = 'waiting_message', updated_at = ?
         WHERE id = ? AND run_id = ? AND schedule_state IN ('executing','runnable')`,
        [now, runtimeId, row.id],
      );
    }
    if (delegationId) {
      await tx.execute(
        `UPDATE agent_scheduler_work SET status = 'cancelled', version = version + 1, updated_at = ?
         WHERE run_id = ? AND agent_runtime_id = ? AND kind = 'model_step' AND status = 'queued'`,
        [now, row.id, runtimeId],
      );
      await tx.execute(
        `UPDATE agent_delegations SET status = 'waiting', version = version + 1, updated_at = ?
         WHERE id = ? AND run_id = ? AND status = 'running'`,
        [now, delegationId, row.id],
      );
    }
    const nextExecuting =
      runtime.schedule_state === 'executing'
        ? Math.max(0, row.executing_runtime_count - 1)
        : row.executing_runtime_count;
    const activeDelta =
      runtime.schedule_state === 'executing' && nextExecuting === 0 && row.active_execution_started_at !== null
        ? Math.max(0, now - row.active_execution_started_at)
        : 0;
    const changed = await tx.execute(
      `UPDATE agent_runs SET status = 'awaiting_input',
         active_execution_seconds = active_execution_seconds + ?,
         active_execution_started_at = CASE WHEN ? = 0 THEN NULL ELSE active_execution_started_at END,
         executing_runtime_count = ?, next_event_sequence = next_event_sequence + ?,
         version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status = ?`,
      [
        activeDelta,
        nextExecuting,
        nextExecuting,
        events.length,
        now,
        row.id,
        row.user_id,
        row.app_id,
        row.version,
        row.status,
      ],
    );
    if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
  } else if (events.length > 0) {
    const changed = await tx.execute(
      `UPDATE agent_runs SET next_event_sequence = next_event_sequence + ?, version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
      [events.length, now, row.id, row.user_id, row.app_id, row.version],
    );
    if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
  }

  const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
  if (!updated) throw new Error('NOT_FOUND');
  const run = mapRunRow(updated);
  if (events.length > 0) await allocateHostEvent(tx, run.userId, 'summary.changed', summaryPayload(run), now);
  return {
    run,
    eventCursor: run.eventCursor,
    ledgerCursor,
    committedEvents,
    warningLevel: nextLevel,
    paused: pause,
    reason,
  };
};
