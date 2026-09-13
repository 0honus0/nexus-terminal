import type { Scope } from '../../../modules/agent/agent.types';
import type { PendingRunInput } from '../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface InputRow {
  id: string;
  sequence: number;
  payload_json: string;
  created_at: number;
}

interface MutationEventRow {
  type: string;
  payload_json: string;
}

interface MutationPayload {
  inputId?: unknown;
  beforeInputId?: unknown;
}

const mapInput = (row: InputRow): PendingRunInput => {
  const payload = JSON.parse(row.payload_json) as { text?: unknown; artifactRefs?: unknown };
  return {
    id: row.id,
    sequence: row.sequence,
    text: typeof payload.text === 'string' ? payload.text : '',
    artifactRefs: Array.isArray(payload.artifactRefs)
      ? payload.artifactRefs.filter((value): value is string => typeof value === 'string')
      : [],
    createdAt: row.created_at,
  };
};

/**
 * Replays durable pending-input mutation events over the immutable user-input Ledger.
 * Ledger rows and their sequence numbers are never changed by queue operations.
 */
export const projectRunUserInputs = async (
  db: RelationalDatabase,
  scope: Scope,
  runId: string,
): Promise<PendingRunInput[]> => {
  const [rows, events] = await Promise.all([
    db.queryAll<InputRow>(
      `SELECT id, sequence, payload_json, created_at
       FROM ai_thread_entries
       WHERE run_id = ? AND user_id = ? AND app_id = ? AND kind = 'user_input'
       ORDER BY sequence`,
      [runId, scope.userId, scope.appId],
    ),
    db.queryAll<MutationEventRow>(
      `SELECT type, payload_json FROM agent_events
       WHERE run_id = ? AND type IN ('input.pending_removed', 'input.pending_moved')
       ORDER BY sequence`,
      [runId],
    ),
  ]);

  const byId = new Map(rows.map((row) => [row.id, mapInput(row)]));
  const orderedIds = rows.map((row) => row.id);
  for (const event of events) {
    const payload = JSON.parse(event.payload_json) as MutationPayload;
    if (typeof payload.inputId !== 'string' || !byId.has(payload.inputId)) continue;
    const sourceIndex = orderedIds.indexOf(payload.inputId);
    if (sourceIndex < 0) continue;
    orderedIds.splice(sourceIndex, 1);
    if (event.type === 'input.pending_removed') continue;
    if (payload.beforeInputId === null || payload.beforeInputId === undefined) {
      orderedIds.push(payload.inputId);
      continue;
    }
    if (typeof payload.beforeInputId !== 'string') continue;
    const targetIndex = orderedIds.indexOf(payload.beforeInputId);
    if (targetIndex < 0) {
      // The target may have been removed by a later queue mutation. Keep deterministic order.
      orderedIds.push(payload.inputId);
      continue;
    }
    orderedIds.splice(targetIndex, 0, payload.inputId);
  }
  return orderedIds.map((id) => byId.get(id)!).filter(Boolean);
};
