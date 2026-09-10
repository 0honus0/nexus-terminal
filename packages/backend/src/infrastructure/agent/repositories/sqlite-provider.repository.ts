import type {
  ProviderCreateRecord,
  ProviderModelConfig,
  ProviderRepositoryPort,
  ProviderUpdateRecord,
  ProviderView,
} from '../../../modules/agent/ai/provider.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type { SecretCipher } from '../../../shared/security/crypto.port';

interface ProviderRow {
  id: string;
  kind: 'openai-compatible';
  display_name: string;
  base_url: string;
  protected_credential: string | null;
  credential_revision: number;
  models_json: string;
  endpoint_policy_json: string;
  enabled: number;
  version: number;
  created_at: number;
  updated_at: number;
}

const columns = `
  id, kind, display_name, base_url, protected_credential, credential_revision,
  models_json, endpoint_policy_json, enabled, version, created_at, updated_at
`;

const mapRow = (row: ProviderRow): ProviderView => {
  const endpointPolicy = JSON.parse(row.endpoint_policy_json) as { privateHostExceptions?: string[] };
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    baseUrl: row.base_url,
    hasCredential: Boolean(row.protected_credential),
    credentialRevision: row.credential_revision,
    models: JSON.parse(row.models_json) as ProviderModelConfig[],
    privateHostExceptions: Array.isArray(endpointPolicy.privateHostExceptions)
      ? endpointPolicy.privateHostExceptions
      : [],
    enabled: row.enabled === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export class SqliteProviderRepository implements ProviderRepositoryPort {
  constructor(
    private readonly db: RelationalDatabase,
    private readonly cipher: SecretCipher,
  ) {}

  async get(userId: number, providerId: string): Promise<ProviderView | null> {
    const row = await this.db.queryOne<ProviderRow>(
      `SELECT ${columns} FROM ai_providers
       WHERE user_id = ? AND id = ? AND deleted_at IS NULL`,
      [userId, providerId],
    );
    return row ? mapRow(row) : null;
  }

  async list(userId: number): Promise<ProviderView[]> {
    const rows = await this.db.queryAll<ProviderRow>(
      `SELECT ${columns} FROM ai_providers
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY display_name COLLATE NOCASE, id`,
      [userId],
    );
    return rows.map(mapRow);
  }

  async create(record: ProviderCreateRecord): Promise<ProviderView> {
    const protectedCredential = record.credential === undefined ? null : this.cipher.encrypt(record.credential);
    await this.db.execute(
      `INSERT INTO ai_providers (
        id, user_id, kind, display_name, base_url, protected_credential, credential_revision,
        models_json, endpoint_policy_json, enabled, deleted_at, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, 1, ?, ?)`,
      [
        record.id,
        record.userId,
        record.kind,
        record.displayName,
        record.baseUrl,
        protectedCredential,
        JSON.stringify(record.models),
        JSON.stringify({ privateHostExceptions: record.privateHostExceptions }),
        record.enabled ? 1 : 0,
        record.createdAt,
        record.updatedAt,
      ],
    );
    const created = await this.get(record.userId, record.id);
    if (!created) throw new Error('PROVIDER_NOT_FOUND');
    return created;
  }

  async update(
    userId: number,
    providerId: string,
    expectedVersion: number,
    record: ProviderUpdateRecord,
  ): Promise<ProviderView> {
    const credentialSql =
      record.credential !== undefined
        ? ', protected_credential = ?, credential_revision = credential_revision + 1'
        : record.clearCredential
          ? ', protected_credential = NULL, credential_revision = credential_revision + 1'
          : '';
    const parameters: unknown[] = [
      record.displayName,
      record.baseUrl,
      JSON.stringify(record.models),
      JSON.stringify({ privateHostExceptions: record.privateHostExceptions }),
      record.enabled ? 1 : 0,
      record.updatedAt,
    ];
    if (record.credential !== undefined) parameters.push(this.cipher.encrypt(record.credential));
    parameters.push(userId, providerId, expectedVersion);

    const result = await this.db.execute(
      `UPDATE ai_providers SET
        display_name = ?, base_url = ?, models_json = ?, endpoint_policy_json = ?, enabled = ?,
        updated_at = ?, version = version + 1${credentialSql}
       WHERE user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL`,
      parameters,
    );
    if (result.changes !== 1) {
      if (await this.get(userId, providerId)) throw new Error('PROVIDER_VERSION_CONFLICT');
      throw new Error('PROVIDER_NOT_FOUND');
    }
    const updated = await this.get(userId, providerId);
    if (!updated) throw new Error('PROVIDER_NOT_FOUND');
    return updated;
  }

  async remove(userId: number, providerId: string, expectedVersion: number, deletedAt: number): Promise<void> {
    const result = await this.db.execute(
      `UPDATE ai_providers SET
        protected_credential = NULL,
        credential_revision = credential_revision + 1,
        enabled = 0,
        deleted_at = ?,
        updated_at = ?,
        version = version + 1
       WHERE user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL`,
      [deletedAt, deletedAt, userId, providerId, expectedVersion],
    );
    if (result.changes === 1) return;
    if (await this.get(userId, providerId)) throw new Error('PROVIDER_VERSION_CONFLICT');
    throw new Error('PROVIDER_NOT_FOUND');
  }
}
