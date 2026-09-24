import type { AgentHostEventTypeDto } from '@nexus-terminal/protocol/agent-events';
import type { JsonValue } from '../../../modules/agent/agent.types';
import type { AppRecord } from '../../../modules/agent/host/app.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

export const HOST_EVENT_RETENTION_LIMIT = 2048;

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
  type: AgentHostEventTypeDto,
  payload: JsonValue,
  occurredAt: number,
): Promise<number> => {
  await tx.execute('INSERT OR IGNORE INTO agent_host_cursors (user_id, next_sequence) VALUES (?, 1)', [userId]);
  const cursor = await tx.queryOne<{ next_sequence: number; oldest_cursor: number }>(
    'SELECT next_sequence, oldest_cursor FROM agent_host_cursors WHERE user_id = ?',
    [userId],
  );
  if (!cursor) throw new Error('HOST_CURSOR_UNAVAILABLE');
  const sequence = cursor.next_sequence;
  const oldestCursor = Math.max(cursor.oldest_cursor, sequence - HOST_EVENT_RETENTION_LIMIT);
  const advanced = await tx.execute(
    `UPDATE agent_host_cursors
     SET next_sequence = next_sequence + 1, oldest_cursor = ?
     WHERE user_id = ? AND next_sequence = ?`,
    [oldestCursor, userId, sequence],
  );
  if (advanced.changes !== 1) throw new Error('STATE_CONFLICT');
  await tx.execute(
    'INSERT INTO agent_host_events (user_id, sequence, type, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?)',
    [userId, sequence, type, JSON.stringify(payload), occurredAt],
  );
  if (oldestCursor > cursor.oldest_cursor) {
    await tx.execute('DELETE FROM agent_host_events WHERE user_id = ? AND sequence <= ?', [userId, oldestCursor]);
  }
  return sequence;
};
