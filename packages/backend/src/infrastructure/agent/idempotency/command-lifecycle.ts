import type { Scope } from '../../../modules/agent/agent.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

export interface DurableCommandRow {
  id: string;
  status: 'pending' | 'committed' | 'unknown';
  request_hash: string;
  response_json: string | null;
  result_entity_id: string | null;
  expires_at: number | null;
}

const readCommand = (
  tx: RelationalDatabase,
  scope: Scope,
  commandName: string,
  idempotencyKey: string,
): Promise<DurableCommandRow | null> =>
  tx.queryOne<DurableCommandRow>(
    `SELECT id, status, request_hash, response_json, result_entity_id, expires_at
     FROM agent_commands
     WHERE user_id = ? AND app_id = ? AND command_name = ? AND idempotency_key = ?`,
    [scope.userId, scope.appId, commandName, idempotencyKey],
  );

/**
 * Read one idempotency record while enforcing the server-side TTL contract.
 *
 * Only an expired terminal committed row is recyclable. Pending/unknown rows retain crash and
 * reconciliation evidence even after expires_at and therefore continue to block key reuse.
 * Callers must invoke this inside the same database transaction that may insert the replacement.
 */
export const commandForReplay = async (
  tx: RelationalDatabase,
  scope: Scope,
  commandName: string,
  idempotencyKey: string,
  now: number,
): Promise<DurableCommandRow | null> => {
  const existing = await readCommand(tx, scope, commandName, idempotencyKey);
  if (!existing || existing.status !== 'committed' || existing.expires_at === null || existing.expires_at > now) {
    return existing;
  }
  const deleted = await tx.execute(
    `DELETE FROM agent_commands
     WHERE id = ? AND status = 'committed' AND expires_at IS NOT NULL AND expires_at <= ?`,
    [existing.id, now],
  );
  if (deleted.changes === 1) return null;
  return readCommand(tx, scope, commandName, idempotencyKey);
};

/** Bounded lifecycle cleanup. Non-terminal command evidence is deliberately never selected. */
export const cleanupExpiredCommittedCommands = async (
  tx: RelationalDatabase,
  now: number,
  limit: number,
): Promise<number> => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('VALIDATION_FAILED');
  const rows = await tx.queryAll<{ id: string }>(
    `SELECT id FROM agent_commands
     WHERE status = 'committed' AND expires_at IS NOT NULL AND expires_at <= ?
     ORDER BY expires_at, id LIMIT ?`,
    [now, limit],
  );
  if (rows.length === 0) return 0;
  const deleted = await tx.execute(
    `DELETE FROM agent_commands
     WHERE status = 'committed' AND expires_at IS NOT NULL AND expires_at <= ?
       AND id IN (${rows.map(() => '?').join(',')})`,
    [now, ...rows.map((row) => row.id)],
  );
  return deleted.changes;
};
