import type { JsonValue } from '../../../modules/agent/agent.types';
import type { AppRecord } from '../../../modules/agent/host/app.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

export const appChangedPayload = (app: AppRecord): JsonValue => ({
  appId: app.appId,
  activeVersion: app.activeVersion,
  desiredState: app.desiredState,
  observedState: app.observedState,
  healthReason: app.healthReason,
  policyRevision: app.policyRevision,
  runningCount: app.runningCount,
  approvalCount: app.approvalCount,
  budgetRequestCount: app.budgetRequestCount,
  acceptNewRuns: app.acceptNewRuns,
  version: app.version,
  updatedAt: app.updatedAt,
});

export const appendHostEvent = async (
  tx: RelationalDatabase,
  userId: number,
  type: 'summary.changed' | 'feature.changed' | 'app.changed' | 'authorization.changed',
  payload: JsonValue,
  occurredAt: number,
): Promise<number> => {
  await tx.execute('INSERT OR IGNORE INTO agent_host_cursors (user_id, next_sequence) VALUES (?, 1)', [userId]);
  const cursor = await tx.queryOne<{ next_sequence: number }>(
    'SELECT next_sequence FROM agent_host_cursors WHERE user_id = ?',
    [userId],
  );
  if (!cursor) throw new Error('HOST_CURSOR_UNAVAILABLE');
  const sequence = cursor.next_sequence;
  const advanced = await tx.execute(
    'UPDATE agent_host_cursors SET next_sequence = next_sequence + 1 WHERE user_id = ? AND next_sequence = ?',
    [userId, sequence],
  );
  if (advanced.changes !== 1) throw new Error('STATE_CONFLICT');
  await tx.execute(
    'INSERT INTO agent_host_events (user_id, sequence, type, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?)',
    [userId, sequence, type, JSON.stringify(payload), occurredAt],
  );
  return sequence;
};
