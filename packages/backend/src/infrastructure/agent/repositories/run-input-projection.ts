import type { Scope } from '../../../modules/agent/agent.types';
import type { PendingRunInput } from '../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import {
  decodeDurableStringArray,
  durableRecord,
  durableString,
  parseDurableJson,
} from '../runtime/durable-state-decoders';

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

const mapInput = (row: InputRow): PendingRunInput => {
  const payload = durableRecord(parseDurableJson(row.payload_json));
  return {
    id: row.id,
    sequence: row.sequence,
    text: durableString(payload.text) as string,
    artifactRefs: decodeDurableStringArray(payload.artifactRefs, 4096),
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
    const payload = durableRecord(parseDurableJson(event.payload_json));
    const inputId = durableString(payload.inputId) as string;
    const beforeInputId = payload.beforeInputId === null ? null : (durableString(payload.beforeInputId) as string);
    if (!byId.has(inputId)) continue;
    const sourceIndex = orderedIds.indexOf(inputId);
    if (sourceIndex < 0) continue;
    orderedIds.splice(sourceIndex, 1);
    if (event.type === 'input.pending_removed') continue;
    if (beforeInputId === null) {
      orderedIds.push(inputId);
      continue;
    }
    const targetIndex = orderedIds.indexOf(beforeInputId);
    if (targetIndex < 0) {
      // The target may have been removed by a later queue mutation. Keep deterministic order.
      orderedIds.push(inputId);
      continue;
    }
    orderedIds.splice(targetIndex, 0, inputId);
  }
  return orderedIds.map((id) => byId.get(id)!).filter(Boolean);
};
