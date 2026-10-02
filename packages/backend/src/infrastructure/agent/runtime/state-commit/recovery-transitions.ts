import type { Scope } from '../../../../modules/agent/agent.types';
import type { DurableEventInput } from '../../../../modules/agent/runtime/runs/state-commit.port';
import type { RunEvent, RunStatus, RunView } from '../../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../../repositories/sqlite-run.mapper';
import {
  allocateHostEvent,
  appendEvents,
  cancelRunSubagentWork,
  COUNTED_LIVE,
  summaryPayload,
  updateAppLiveCount,
} from './transaction-primitives';

interface RecoveryObservation {
  run: RunView;
  events: RunEvent[];
}

interface RestartMutationLeaseRow {
  id: string;
  resource_key: string;
  owner_type: string;
  owner_id: string;
  fence: number;
  expires_at: number;
  operation_id: string | null;
  tool_call_id: string | null;
}

/**
 * Close durable in-flight child state before a Run is made terminal.
 *
 * Mutation recovery is intentionally evidence-driven: only an active mutation lease proves that
 * the execution crossed the pre-side-effect activation boundary. Those leases are materialized as
 * quarantine records before the caller may set needs_reconciliation. A mutation Tool that never
 * activated its lease is safe to cancel like other not-yet-executed work.
 */
const settleInterruptedRunChildren = async (
  tx: RelationalDatabase,
  row: RunRow,
  now: number,
  reason: 'backend_restart' | 'app_disabled',
): Promise<{ needsReconciliation: boolean }> => {
  const mutationLeases = await tx.queryAll<RestartMutationLeaseRow>(
    `SELECT l.id, l.resource_key, l.owner_type, l.owner_id, l.fence, l.expires_at, l.operation_id,
            CASE WHEN tc.id IS NULL THEN NULL ELSE tc.id END AS tool_call_id
     FROM agent_leases l
     JOIN agent_runtimes rt ON rt.id = l.owner_id AND l.owner_type = 'agent'
     LEFT JOIN agent_tool_calls tc ON tc.id = l.operation_id AND tc.run_id = rt.run_id
     WHERE rt.run_id = ? AND l.active_mutation = 1
     ORDER BY l.resource_key, l.id`,
    [row.id],
  );

  for (const lease of mutationLeases) {
    const evidence = JSON.stringify({
      reason,
      leaseId: lease.id,
      operationId: lease.operation_id,
      fence: lease.fence,
      expiresAt: lease.expires_at,
    });
    await tx.execute(
      `INSERT INTO agent_resource_quarantine
        (resource_key, tool_call_id, owner_type, owner_id, reason, evidence_json, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(resource_key) DO UPDATE SET
         tool_call_id = CASE
           WHEN agent_resource_quarantine.owner_type = excluded.owner_type
            AND agent_resource_quarantine.owner_id = excluded.owner_id
           THEN COALESCE(agent_resource_quarantine.tool_call_id, excluded.tool_call_id)
           ELSE agent_resource_quarantine.tool_call_id
         END,
         reason = CASE
           WHEN agent_resource_quarantine.owner_type = excluded.owner_type
            AND agent_resource_quarantine.owner_id = excluded.owner_id
           THEN excluded.reason ELSE agent_resource_quarantine.reason END,
         evidence_json = CASE
           WHEN agent_resource_quarantine.owner_type = excluded.owner_type
            AND agent_resource_quarantine.owner_id = excluded.owner_id
           THEN excluded.evidence_json ELSE agent_resource_quarantine.evidence_json END,
         version = CASE
           WHEN agent_resource_quarantine.owner_type = excluded.owner_type
            AND agent_resource_quarantine.owner_id = excluded.owner_id
           THEN agent_resource_quarantine.version + 1 ELSE agent_resource_quarantine.version END,
         created_at = CASE
           WHEN agent_resource_quarantine.owner_type = excluded.owner_type
            AND agent_resource_quarantine.owner_id = excluded.owner_id
           THEN excluded.created_at ELSE agent_resource_quarantine.created_at END`,
      [
        lease.resource_key,
        lease.tool_call_id,
        lease.owner_type,
        lease.owner_id,
        reason === 'backend_restart' ? 'BACKEND_RESTART_DURING_MUTATION' : 'APP_DISABLED_DURING_MUTATION',
        evidence,
        now,
      ],
    );
  }

  const reconciliation = await tx.queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM agent_resource_quarantine q
     JOIN agent_runtimes rt ON rt.id = q.owner_id AND q.owner_type = 'agent'
     WHERE rt.run_id = ?`,
    [row.id],
  );
  const needsReconciliation = (reconciliation?.count ?? 0) > 0;

  // A process restart cannot resume a provider stream safely. Abort every non-terminal attempt and
  // close its model step so a terminal Run never retains durable streaming/running child state.
  await tx.execute(
    `UPDATE agent_model_attempts
     SET status = 'aborted', error_code = COALESCE(error_code, ?), completed_at = COALESCE(completed_at, ?)
     WHERE step_id IN (SELECT id FROM agent_steps WHERE run_id = ? AND kind = 'model')
       AND status IN ('planned','reserved','streaming')`,
    [reason === 'backend_restart' ? 'BACKEND_RESTART' : 'APP_DISABLED', now, row.id],
  );

  // Tool calls backed by quarantine remain explicitly reconciling. Every other non-terminal Tool
  // call is safe to cancel because no active mutation lease proves side effects may have started.
  await tx.execute(
    `UPDATE agent_tool_calls
     SET status = CASE
           WHEN EXISTS (
             SELECT 1 FROM agent_resource_quarantine q
             WHERE q.tool_call_id = agent_tool_calls.id
           ) THEN 'reconciling'
           ELSE 'cancelled'
         END,
         completed_at = CASE
           WHEN EXISTS (
             SELECT 1 FROM agent_resource_quarantine q
             WHERE q.tool_call_id = agent_tool_calls.id
           ) THEN completed_at
           ELSE COALESCE(completed_at, ?)
         END,
         version = version + 1
     WHERE run_id = ?
       AND status IN ('proposed','awaiting_approval','ready','running','reconciling')`,
    [now, row.id],
  );

  await tx.execute(
    `UPDATE agent_steps
     SET status = CASE
           WHEN kind = 'tool' AND EXISTS (
             SELECT 1 FROM agent_tool_calls tc
             WHERE tc.step_id = agent_steps.id AND tc.status = 'reconciling'
           ) THEN 'failed'
           ELSE 'cancelled'
         END,
         completed_at = COALESCE(completed_at, ?)
     WHERE run_id = ? AND kind IN ('model','tool') AND status IN ('created','running')`,
    [now, row.id],
  );

  return { needsReconciliation };
};

const cancelPendingUserInputRequest = async (
  tx: RelationalDatabase,
  row: RunRow,
  _now: number,
): Promise<string | null> => {
  const pending = await tx.queryOne<{ id: string; version: number }>(
    `SELECT id, version FROM agent_input_requests
     WHERE run_id = ? AND user_id = ? AND app_id = ? AND status = 'requested'
     ORDER BY requested_at DESC, id DESC LIMIT 1`,
    [row.id, row.user_id, row.app_id],
  );
  if (!pending) return null;
  const changed = await tx.execute(
    `UPDATE agent_input_requests SET status = 'cancelled', version = version + 1
     WHERE id = ? AND run_id = ? AND status = 'requested' AND version = ?`,
    [pending.id, row.id, pending.version],
  );
  if (changed.changes !== 1) throw new Error('USER_INPUT_REQUEST_STATE_CONFLICT');
  return pending.id;
};

export const supersedeUnconsumedRunApprovals = async (
  tx: RelationalDatabase,
  row: RunRow,
  now: number,
): Promise<number> => {
  const requested = await tx.queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count FROM agent_approvals
     WHERE run_id = ? AND user_id = ? AND app_id = ? AND status = 'requested'`,
    [row.id, row.user_id, row.app_id],
  );
  const changed = await tx.execute(
    `UPDATE agent_approvals SET status = 'superseded', decided_at = COALESCE(decided_at, ?), version = version + 1
     WHERE run_id = ? AND user_id = ? AND app_id = ?
       AND (status = 'requested' OR (status = 'approved' AND consumed_at IS NULL))`,
    [now, row.id, row.user_id, row.app_id],
  );
  const requestedCount = requested?.count ?? 0;
  if (requestedCount > 0) {
    await tx.execute(
      `UPDATE agent_apps SET approval_count = MAX(0, approval_count - ?), updated_at = ?
       WHERE user_id = ? AND app_id = ?`,
      [requestedCount, now, row.user_id, row.app_id],
    );
  }
  return changed.changes;
};

export async function quiesceAppTransition(tx: RelationalDatabase, scope: Scope, now: number) {
  const observed: RecoveryObservation[] = [];
  const rows = await tx.queryAll<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs
         WHERE user_id = ? AND app_id = ?
           AND status IN ('created','running','awaiting_approval','awaiting_budget','awaiting_input','cancelling')
         ORDER BY created_at, id`,
    [scope.userId, scope.appId],
  );
  for (const row of rows) {
    const nextStatus: RunStatus = row.status === 'running' || row.status === 'cancelling' ? 'interrupted' : 'cancelled';
    const { needsReconciliation } = await settleInterruptedRunChildren(tx, row, now, 'app_disabled');
    const pendingInputRequestId = await cancelPendingUserInputRequest(tx, row, now);
    const events: DurableEventInput[] = [];
    if (pendingInputRequestId) {
      events.push({
        type: 'input.request_cancelled',
        payload: { requestId: pendingInputRequestId, reason: 'app_disabled' },
      });
    }
    events.push(
      {
        type: nextStatus === 'interrupted' ? 'run.interrupted' : 'run.cancelled',
        payload: { reason: 'app_disabled', needsReconciliation },
      },
      { type: 'run.status_changed', payload: { from: row.status, to: nextStatus } },
    );
    const committedEvents = await appendEvents(tx, row, events, now);
    const changed = await tx.execute(
      `UPDATE agent_runs SET status = ?, needs_reconciliation = ?, completed_at = ?, updated_at = ?,
             version = version + 1, executing_runtime_count = 0, active_execution_started_at = NULL,
             next_event_sequence = next_event_sequence + ?
           WHERE id = ? AND version = ?`,
      [nextStatus, needsReconciliation ? 1 : 0, now, now, events.length, row.id, row.version],
    );
    if (changed.changes !== 1) throw new Error('STATE_CONFLICT');

    await supersedeUnconsumedRunApprovals(tx, row, now);
    if (row.status === 'awaiting_budget') {
      await tx.execute(
        `UPDATE agent_apps SET budget_request_count = MAX(0, budget_request_count - 1), updated_at = ?
             WHERE user_id = ? AND app_id = ?`,
        [now, row.user_id, row.app_id],
      );
    }

    await cancelRunSubagentWork(tx, row.id, now, true);
    await tx.execute(
      `UPDATE agent_runtimes SET status = ?, updated_at = ?
           WHERE run_id = ? AND status IN ('created','running','stopping','interrupted')`,
      [nextStatus === 'interrupted' ? 'interrupted' : 'stopped', now, row.id],
    );
    if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, now);
    const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
    if (updated) {
      const run = mapRunRow(updated);
      observed.push({ run, events: committedEvents });
      await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(run), now);
    }
  }
  return { count: rows.length, observed };
}

export async function interruptNonTerminalRunsTransition(tx: RelationalDatabase, now: number) {
  const observed: RecoveryObservation[] = [];
  const rows = await tx.queryAll<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM agent_runs
         WHERE status IN ('created','running','awaiting_approval','awaiting_budget','awaiting_input','cancelling')
         ORDER BY created_at, id`,
  );
  for (const row of rows) {
    const { needsReconciliation } = await settleInterruptedRunChildren(tx, row, now, 'backend_restart');
    const pendingInputRequestId = await cancelPendingUserInputRequest(tx, row, now);
    const events: DurableEventInput[] = [];
    if (pendingInputRequestId) {
      events.push({
        type: 'input.request_cancelled',
        payload: { requestId: pendingInputRequestId, reason: 'backend_restart' },
      });
    }
    events.push(
      { type: 'run.interrupted', payload: { reason: 'backend_restart', needsReconciliation } },
      { type: 'run.status_changed', payload: { from: row.status, to: 'interrupted' } },
    );
    const committedEvents = await appendEvents(tx, row, events, now);
    const changed = await tx.execute(
      `UPDATE agent_runs SET status = 'interrupted', needs_reconciliation = ?, completed_at = ?, updated_at = ?,
             version = version + 1, executing_runtime_count = 0, active_execution_started_at = NULL,
             next_event_sequence = next_event_sequence + ?
           WHERE id = ? AND version = ?`,
      [needsReconciliation ? 1 : 0, now, now, events.length, row.id, row.version],
    );
    if (changed.changes !== 1) throw new Error('STATE_CONFLICT');

    await supersedeUnconsumedRunApprovals(tx, row, now);
    if (row.status === 'awaiting_budget') {
      await tx.execute(
        `UPDATE agent_apps SET budget_request_count = MAX(0, budget_request_count - 1), updated_at = ?
             WHERE user_id = ? AND app_id = ?`,
        [now, row.user_id, row.app_id],
      );
    }

    await tx.execute(
      `UPDATE agent_tool_calls SET status = 'cancelled', completed_at = ?, version = version + 1
           WHERE run_id = ? AND status = 'awaiting_approval'`,
      [now, row.id],
    );
    await tx.execute(
      `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
           WHERE run_id = ? AND kind = 'tool' AND status = 'created'`,
      [now, row.id],
    );
    await tx.execute(
      `UPDATE agent_runtimes SET status = 'interrupted', schedule_state = 'finished', updated_at = ?
           WHERE run_id = ? AND status IN ('created','running','stopping','interrupted')`,
      [now, row.id],
    );
    await cancelRunSubagentWork(tx, row.id, now, true);
    if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, now);
    const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
    if (updated) {
      const run = mapRunRow(updated);
      observed.push({ run, events: committedEvents });
      await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(run), now);
    }
  }
  return observed;
}

export async function findRestartRecoveryCandidates(
  db: RelationalDatabase,
  observed: readonly RecoveryObservation[],
): Promise<RunView[]> {
  const recoveryCandidates = new Map(observed.map((item) => [item.run.id, item.run] as const));
  const prior = await db.queryAll<{ id: string; type: string; payload_json: string }>(
    `SELECT r.id,e.type,e.payload_json
       FROM agent_runs r
       JOIN agent_events e ON e.run_id=r.id
       WHERE r.status='interrupted' AND r.needs_reconciliation=0
         AND e.sequence=(
           SELECT MAX(e2.sequence) FROM agent_events e2
           WHERE e2.run_id=r.id
             AND e2.type IN ('run.interrupted','run.recovery_deferred','run.recovery_continued','run.recovery_failed')
         )
       ORDER BY r.created_at,r.id`,
  );
  for (const candidate of prior) {
    if (recoveryCandidates.has(candidate.id)) continue;
    let eligible = candidate.type === 'run.recovery_deferred';
    if (candidate.type === 'run.interrupted') {
      try {
        const payload = JSON.parse(candidate.payload_json) as { reason?: unknown };
        eligible = payload.reason === 'backend_restart';
      } catch {
        eligible = false;
      }
    }
    if (!eligible) continue;
    const row = await db.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id=?`, [candidate.id]);
    if (row) recoveryCandidates.set(row.id, mapRunRow(row));
  }
  return [...recoveryCandidates.values()];
}
