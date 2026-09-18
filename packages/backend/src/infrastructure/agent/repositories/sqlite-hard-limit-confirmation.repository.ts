import type {
  HardLimitConfirmationRecord,
  HardLimitConfirmationRepositoryPort,
} from '../../../modules/agent/host/hard-limit-confirmation.repository.port';
import { createDefaultAgentSettings } from '../../../modules/agent/agent-defaults';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { durableInteger, durableRecord, parseDurableJson } from '../runtime/durable-state-decoders';

interface ConfirmationRow {
  id: string;
  user_id: number;
  expected_revision: number;
  proposed_json: string;
  created_at: number;
  expires_at: number;
}

const decodeHardLimits = (raw: string): HardLimitConfirmationRecord['proposed'] => {
  const record = durableRecord(parseDurableJson(raw));
  const defaults = createDefaultAgentSettings().hardLimits;
  const expected = Object.keys(defaults) as Array<keyof typeof defaults>;
  if (Object.keys(record).length !== expected.length || expected.some((key) => !(key in record))) {
    throw new Error('AGENT_DURABLE_STATE_INVALID');
  }
  return Object.fromEntries(expected.map((key) => [key, durableInteger(record[key], 1)])) as unknown as HardLimitConfirmationRecord['proposed'];
};

const mapRow = (row: ConfirmationRow): HardLimitConfirmationRecord => ({
  id: row.id,
  userId: row.user_id,
  expectedRevision: row.expected_revision,
  proposed: decodeHardLimits(row.proposed_json),
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});

export class SqliteHardLimitConfirmationRepository implements HardLimitConfirmationRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async save(record: HardLimitConfirmationRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO agent_hard_limit_confirmations
        (id, user_id, expected_revision, proposed_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.userId,
        record.expectedRevision,
        JSON.stringify(record.proposed),
        record.createdAt,
        record.expiresAt,
      ],
    );
  }

  async get(userId: number, confirmationId: string): Promise<HardLimitConfirmationRecord | null> {
    const row = await this.db.queryOne<ConfirmationRow>(
      `SELECT id, user_id, expected_revision, proposed_json, created_at, expires_at
       FROM agent_hard_limit_confirmations WHERE id = ? AND user_id = ?`,
      [confirmationId, userId],
    );
    return row ? mapRow(row) : null;
  }

  async delete(userId: number, confirmationId: string): Promise<void> {
    await this.db.execute('DELETE FROM agent_hard_limit_confirmations WHERE id = ? AND user_id = ?', [
      confirmationId,
      userId,
    ]);
  }

  async deleteExpired(now: number): Promise<void> {
    await this.db.execute('DELETE FROM agent_hard_limit_confirmations WHERE expires_at <= ?', [now]);
  }
}
