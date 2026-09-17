import type { JsonValue } from '../../../modules/agent/agent.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface PendingJoin {
  toolCallId: string;
  delegationIds: string[];
  mode: 'all' | 'any';
  deadlineAt: number;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const parseJson = (raw: string | null): unknown => {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const pendingJoin = (toolCallId: string, inspectionJson: string, resultJson: string | null): PendingJoin | null => {
  const inspection = record(parseJson(inspectionJson));
  const result = record(parseJson(resultJson));
  const data = record(result?.data);
  if (!inspection || data?.ready !== false) return null;
  const args = record(inspection.normalizedArguments);
  if (!args || !Array.isArray(args.delegationIds)) return null;
  const delegationIds = args.delegationIds.filter(
    (value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128,
  );
  if (delegationIds.length < 1 || delegationIds.length !== args.delegationIds.length || delegationIds.length > 64) return null;
  const mode = args.mode === 'any' ? 'any' : args.mode === 'all' ? 'all' : null;
  const deadlineAt = args.deadlineAt;
  if (!mode || !Number.isSafeInteger(deadlineAt) || (deadlineAt as number) < 1) return null;
  return { toolCallId, delegationIds, mode, deadlineAt: deadlineAt as number };
};

/**
 * Durable control wake for a runtime parked in `joining`.
 *
 * The work id is bound to the exact join_subagents ToolCall so concurrent child completions merge
 * into one wake. A later child can requeue the same work after an earlier wake found the join still
 * not ready. Completion mailbox delivery is deliberately not part of this control path.
 */
export const enqueueParentJoinResume = async (
  tx: RelationalDatabase,
  runId: string,
  parentRuntimeId: string,
  completedDelegationId: string,
  now: number,
): Promise<boolean> => {
  const runtime = await tx.queryOne<{ status: string; schedule_state: string }>(
    `SELECT status, schedule_state FROM agent_runtimes WHERE id = ? AND run_id = ?`,
    [parentRuntimeId, runId],
  );
  if (!runtime || runtime.status !== 'running' || runtime.schedule_state !== 'joining') return false;

  const tool = await tx.queryOne<{ id: string; inspection_json: string; result_json: string | null }>(
    `SELECT id, inspection_json, result_json
     FROM agent_tool_calls
     WHERE run_id = ? AND agent_runtime_id = ? AND tool_name = 'join_subagents' AND status = 'succeeded'
     ORDER BY completed_at DESC, created_at DESC, id DESC
     LIMIT 1`,
    [runId, parentRuntimeId],
  );
  if (!tool) return false;
  const join = pendingJoin(tool.id, tool.inspection_json, tool.result_json);
  if (!join) return false;

  const parentDelegation = await tx.queryOne<{ id: string; deadline_at: number }>(
    `SELECT id, deadline_at FROM agent_delegations WHERE run_id = ? AND child_runtime_id = ? LIMIT 1`,
    [runId, parentRuntimeId],
  );
  const controlDeadline = Math.max(now + 1, Math.min(join.deadlineAt, parentDelegation?.deadline_at ?? join.deadlineAt));
  const workId = `join-resume:${join.toolCallId}`;
  const payload: JsonValue = {
    parentDelegationId: parentDelegation?.id ?? null,
    joinToolCallId: join.toolCallId,
    delegationIds: join.delegationIds,
    mode: join.mode,
    joinDeadlineAt: join.deadlineAt,
    completedDelegationId,
  };
  await tx.execute(
    `INSERT OR IGNORE INTO agent_scheduler_work
      (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch, not_before,
       deadline_at, created_at, updated_at, version)
     VALUES (?, ?, ?, 'join_resume', 'queued', ?, NULL, ?, ?, ?, ?, 1)`,
    [workId, runId, parentRuntimeId, JSON.stringify(payload), now, controlDeadline, now, now],
  );
  await tx.execute(
    `UPDATE agent_scheduler_work
     SET status = 'queued', payload_json = ?, owner_epoch = NULL, not_before = MIN(not_before, ?),
         deadline_at = MAX(deadline_at, ?), version = version + 1, updated_at = ?
     WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'join_resume'
       AND status IN ('completed','cancelled','waiting')`,
    [JSON.stringify(payload), now, controlDeadline, now, workId, runId, parentRuntimeId],
  );
  return true;
};
