import type {
  EnvironmentConfirmationRecord,
  EnvironmentConfirmationRepositoryPort,
} from '../../../modules/agent/environments/environment-confirmation.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface Row {
  id: string;
  user_id: number;
  kind: EnvironmentConfirmationRecord['kind'];
  expected_settings_revision: number;
  catalog_revision: string;
  payload_json: string;
  snapshot_json: string;
  created_at: number;
  expires_at: number;
}

const mapRow = (row: Row): EnvironmentConfirmationRecord => ({
  id: row.id,
  userId: row.user_id,
  kind: row.kind,
  expectedSettingsRevision: row.expected_settings_revision,
  catalogRevision: row.catalog_revision,
  payload: JSON.parse(row.payload_json) as EnvironmentConfirmationRecord['payload'],
  snapshot: JSON.parse(row.snapshot_json) as EnvironmentConfirmationRecord['snapshot'],
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});

export class SqliteEnvironmentConfirmationRepository implements EnvironmentConfirmationRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async save(record: EnvironmentConfirmationRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO agent_environment_confirmations
        (id,user_id,kind,expected_settings_revision,catalog_revision,payload_json,snapshot_json,created_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        record.id,
        record.userId,
        record.kind,
        record.expectedSettingsRevision,
        record.catalogRevision,
        JSON.stringify(record.payload),
        JSON.stringify(record.snapshot),
        record.createdAt,
        record.expiresAt,
      ],
    );
  }

  async get(userId: number, confirmationId: string): Promise<EnvironmentConfirmationRecord | null> {
    const row = await this.db.queryOne<Row>(
      `SELECT id,user_id,kind,expected_settings_revision,catalog_revision,payload_json,snapshot_json,created_at,expires_at
       FROM agent_environment_confirmations WHERE id=? AND user_id=?`,
      [confirmationId, userId],
    );
    return row ? mapRow(row) : null;
  }

  async delete(userId: number, confirmationId: string): Promise<void> {
    await this.db.execute('DELETE FROM agent_environment_confirmations WHERE id=? AND user_id=?', [
      confirmationId,
      userId,
    ]);
  }

  async deleteExpired(now: number): Promise<void> {
    await this.db.execute('DELETE FROM agent_environment_confirmations WHERE expires_at<=?', [now]);
  }
}
