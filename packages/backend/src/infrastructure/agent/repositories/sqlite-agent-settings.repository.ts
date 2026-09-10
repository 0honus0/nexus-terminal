import type {
  AgentSettingsDocument,
  AgentSettingsRecord,
  AgentSettingsRepositoryPort,
} from '../../../modules/agent/host/agent-settings.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface SettingsRow {
  user_id: number;
  value_json: string;
  revision: number;
  updated_at: number;
}

const mapRow = (row: SettingsRow): AgentSettingsRecord => ({
  userId: row.user_id,
  settings: JSON.parse(row.value_json) as AgentSettingsDocument,
  revision: row.revision,
  updatedAt: row.updated_at,
});

export class SqliteAgentSettingsRepository implements AgentSettingsRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async get(userId: number): Promise<AgentSettingsRecord | null> {
    const row = await this.db.queryOne<SettingsRow>(
      'SELECT user_id, value_json, revision, updated_at FROM agent_settings WHERE user_id = ?',
      [userId],
    );
    return row ? mapRow(row) : null;
  }

  async insertDefault(record: AgentSettingsRecord): Promise<boolean> {
    const result = await this.db.execute(
      `INSERT OR IGNORE INTO agent_settings (user_id, value_json, revision, updated_at)
       VALUES (?, ?, ?, ?)`,
      [record.userId, JSON.stringify(record.settings), record.revision, record.updatedAt],
    );
    return result.changes === 1;
  }

  async compareAndSet(
    userId: number,
    expectedRevision: number,
    settings: AgentSettingsDocument,
    updatedAt: number,
  ): Promise<AgentSettingsRecord> {
    const result = await this.db.execute(
      `UPDATE agent_settings
       SET value_json = ?, revision = revision + 1, updated_at = ?
       WHERE user_id = ? AND revision = ?`,
      [JSON.stringify(settings), updatedAt, userId, expectedRevision],
    );
    if (result.changes !== 1) throw new Error('SETTINGS_VERSION_CONFLICT');

    const updated = await this.get(userId);
    if (!updated) throw new Error('AGENT_SETTINGS_NOT_FOUND');
    return updated;
  }
}
