import type { Scope } from '../../../modules/agent/agent.types';
import type {
  IntegrationCreateRecord,
  IntegrationRepositoryPort,
  IntegrationSecretPort,
  IntegrationUpdateRecord,
} from '../../../modules/agent/ai/integration.repository.port';
import type {
  IntegrationConfiguration,
  IntegrationKind,
  IntegrationView,
} from '../../../modules/agent/ai/integrations.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type { SecretCipher } from '../../../shared/security/crypto.port';

interface IntegrationRow {
  id: string;
  user_id: number;
  app_id: string;
  kind: IntegrationKind;
  configuration_json: string;
  protected_credential: string | null;
  credential_revision: number;
  schema_hash: string | null;
  enabled: number;
  version: number;
  created_at: number;
  updated_at: number;
}

const columns = `id, user_id, app_id, kind, configuration_json, protected_credential,
  credential_revision, schema_hash, enabled, version, created_at, updated_at`;

const mapRow = (row: IntegrationRow): IntegrationView => ({
  id: row.id,
  userId: row.user_id,
  appId: row.app_id,
  kind: row.kind,
  configuration: JSON.parse(row.configuration_json) as IntegrationConfiguration,
  hasCredential: Boolean(row.protected_credential),
  credentialRevision: row.credential_revision,
  schemaHash: row.schema_hash,
  enabled: row.enabled === 1,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class SqliteIntegrationRepository implements IntegrationRepositoryPort, IntegrationSecretPort {
  constructor(
    private readonly db: RelationalDatabase,
    private readonly cipher: SecretCipher,
  ) {}

  async get(scope: Scope, integrationId: string): Promise<IntegrationView | null> {
    const row = await this.db.queryOne<IntegrationRow>(
      `SELECT ${columns} FROM agent_integrations WHERE id = ? AND user_id = ? AND app_id = ?`,
      [integrationId, scope.userId, scope.appId],
    );
    return row ? mapRow(row) : null;
  }

  async list(scope: Scope, kind?: IntegrationKind): Promise<IntegrationView[]> {
    const rows = await this.db.queryAll<IntegrationRow>(
      `SELECT ${columns} FROM agent_integrations
       WHERE user_id = ? AND app_id = ?${kind ? ' AND kind = ?' : ''}
       ORDER BY updated_at DESC, id`,
      kind ? [scope.userId, scope.appId, kind] : [scope.userId, scope.appId],
    );
    return rows.map(mapRow);
  }

  async create(record: IntegrationCreateRecord): Promise<IntegrationView> {
    await this.db.execute(
      `INSERT INTO agent_integrations
        (id, user_id, app_id, kind, configuration_json, protected_credential, credential_revision,
         schema_hash, enabled, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, 1, ?, ?)`,
      [
        record.id,
        record.scope.userId,
        record.scope.appId,
        record.kind,
        JSON.stringify(record.configuration),
        record.credential === undefined ? null : this.cipher.encrypt(record.credential),
        record.enabled ? 1 : 0,
        record.createdAt,
        record.createdAt,
      ],
    );
    const created = await this.get(record.scope, record.id);
    if (!created) throw new Error('INTEGRATION_NOT_FOUND');
    return created;
  }

  async update(
    scope: Scope,
    integrationId: string,
    expectedVersion: number,
    record: IntegrationUpdateRecord,
  ): Promise<IntegrationView> {
    const credentialSql =
      record.credential !== undefined
        ? ', protected_credential = ?, credential_revision = credential_revision + 1'
        : record.clearCredential
          ? ', protected_credential = NULL, credential_revision = credential_revision + 1'
          : '';
    const parameters: unknown[] = [JSON.stringify(record.configuration), record.enabled ? 1 : 0, record.updatedAt];
    if (record.credential !== undefined) parameters.push(this.cipher.encrypt(record.credential));
    parameters.push(integrationId, scope.userId, scope.appId, expectedVersion);
    const updated = await this.db.execute(
      `UPDATE agent_integrations SET configuration_json = ?, enabled = ?, schema_hash = NULL,
       updated_at = ?, version = version + 1${credentialSql}
       WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?`,
      parameters,
    );
    if (updated.changes !== 1) {
      if (await this.get(scope, integrationId)) throw new Error('INTEGRATION_VERSION_CONFLICT');
      throw new Error('INTEGRATION_NOT_FOUND');
    }
    const view = await this.get(scope, integrationId);
    if (!view) throw new Error('INTEGRATION_NOT_FOUND');
    return view;
  }

  async updateSchemaHash(
    scope: Scope,
    integrationId: string,
    schemaHash: string | null,
    updatedAt: number,
  ): Promise<void> {
    const result = await this.db.execute(
      `UPDATE agent_integrations SET schema_hash = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND app_id = ?`,
      [schemaHash, updatedAt, integrationId, scope.userId, scope.appId],
    );
    if (result.changes !== 1) throw new Error('INTEGRATION_NOT_FOUND');
  }

  async remove(scope: Scope, integrationId: string, expectedVersion: number): Promise<void> {
    const result = await this.db.execute(
      'DELETE FROM agent_integrations WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?',
      [integrationId, scope.userId, scope.appId, expectedVersion],
    );
    if (result.changes === 1) return;
    if (await this.get(scope, integrationId)) throw new Error('INTEGRATION_VERSION_CONFLICT');
    throw new Error('INTEGRATION_NOT_FOUND');
  }

  async withCredential<T>(
    scope: Scope,
    integrationId: string,
    credentialRevision: number,
    work: (credential: string | null) => Promise<T>,
  ): Promise<T> {
    const row = await this.db.queryOne<{ protected_credential: string | null; credential_revision: number }>(
      `SELECT protected_credential, credential_revision FROM agent_integrations
       WHERE id = ? AND user_id = ? AND app_id = ?`,
      [integrationId, scope.userId, scope.appId],
    );
    if (!row) throw new Error('INTEGRATION_NOT_FOUND');
    if (row.credential_revision !== credentialRevision) throw new Error('INTEGRATION_CREDENTIAL_STALE');
    const credential = row.protected_credential ? this.cipher.decrypt(row.protected_credential) : null;
    return work(credential);
  }
}
