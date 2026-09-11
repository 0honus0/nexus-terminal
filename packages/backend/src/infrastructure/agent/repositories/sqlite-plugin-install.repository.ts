import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { appendHostEvent, appChangedPayload } from '../events/host-event-outbox';
import type {
  PluginInstallRepositoryPort,
  PluginInstallationRecord,
  PluginStageRecord,
  PluginStageStatus,
  PluginVersionRecord,
  PluginVersionStatus,
  TrustedPublisherKey,
} from '../../../modules/agent/host/plugin-install.repository.port';
import type { AgentAppManifest, AppRecord } from '../../../modules/agent/host/app.types';

interface PublisherRow {
  user_id: number;
  key_id: string;
  public_key_pem: string;
  label: string;
  created_at: number;
  revoked_at: number | null;
}

interface StageRow {
  id: string;
  user_id: number;
  artifact_app_id: string;
  artifact_id: string;
  package_hash: string;
  size_bytes: number;
  publisher_key_id: string | null;
  app_id: string | null;
  app_version: string | null;
  manifest_json: string | null;
  status: PluginStageStatus;
  error_code: string | null;
  created_at: number;
  updated_at: number;
  version: number;
}

interface InstallationRow {
  user_id: number;
  app_id: string;
  version: string;
  status: 'installed' | 'removed';
  created_at: number;
  updated_at: number;
}

interface AppStateRow {
  user_id: number;
  app_id: string;
  active_version: string;
  desired_state: AppRecord['desiredState'];
  observed_state: AppRecord['observedState'];
  health_reason: string | null;
  policy_revision: number;
  running_count: number;
  approval_count: number;
  budget_request_count: number;
  accept_new_runs: number;
  version: number;
  created_at: number;
  updated_at: number;
}

interface VersionRow {
  app_id: string;
  version: string;
  package_hash: string;
  publisher_key_id: string;
  manifest_json: string;
  frontend_entry: string | null;
  backend_entry: string | null;
  runner_entry: string | null;
  skill_files_json: string;
  status: PluginVersionStatus;
  installed_at: number | null;
  updated_at: number;
}

const mapPublisher = (row: PublisherRow): TrustedPublisherKey => ({
  userId: row.user_id,
  keyId: row.key_id,
  publicKeyPem: row.public_key_pem,
  label: row.label,
  createdAt: row.created_at,
  revokedAt: row.revoked_at,
});

const mapStage = (row: StageRow): PluginStageRecord => ({
  id: row.id,
  userId: row.user_id,
  artifactAppId: row.artifact_app_id,
  artifactId: row.artifact_id,
  packageHash: row.package_hash,
  sizeBytes: row.size_bytes,
  publisherKeyId: row.publisher_key_id,
  appId: row.app_id,
  version: row.app_version,
  manifest: row.manifest_json ? (JSON.parse(row.manifest_json) as AgentAppManifest) : null,
  status: row.status,
  errorCode: row.error_code,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  versionNumber: row.version,
});

const mapInstallation = (row: InstallationRow): PluginInstallationRecord => ({
  userId: row.user_id,
  appId: row.app_id,
  version: row.version,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapAppState = (row: AppStateRow): AppRecord => ({
  userId: row.user_id,
  appId: row.app_id,
  activeVersion: row.active_version,
  desiredState: row.desired_state,
  observedState: row.observed_state,
  healthReason: row.health_reason,
  policyRevision: row.policy_revision,
  runningCount: row.running_count,
  approvalCount: row.approval_count,
  budgetRequestCount: row.budget_request_count,
  acceptNewRuns: row.accept_new_runs === 1,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapVersion = (row: VersionRow): PluginVersionRecord => ({
  appId: row.app_id,
  version: row.version,
  packageHash: row.package_hash,
  publisherKeyId: row.publisher_key_id,
  manifest: JSON.parse(row.manifest_json) as AgentAppManifest,
  frontendEntry: row.frontend_entry,
  backendEntry: row.backend_entry,
  runnerEntry: row.runner_entry,
  skillFiles: JSON.parse(row.skill_files_json) as string[],
  status: row.status,
  installedAt: row.installed_at,
  updatedAt: row.updated_at,
});

const STAGE_COLUMNS = `id,user_id,artifact_app_id,artifact_id,package_hash,size_bytes,publisher_key_id,app_id,app_version,manifest_json,status,error_code,created_at,updated_at,version`;
const VERSION_COLUMNS = `app_id,version,package_hash,publisher_key_id,manifest_json,frontend_entry,backend_entry,runner_entry,skill_files_json,status,installed_at,updated_at`;
const APP_STATE_COLUMNS = `user_id,app_id,active_version,desired_state,observed_state,health_reason,policy_revision,running_count,approval_count,budget_request_count,accept_new_runs,version,created_at,updated_at`;

export class SqlitePluginInstallRepository implements PluginInstallRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async listPublisherKeys(userId: number): Promise<TrustedPublisherKey[]> {
    const rows = await this.db.queryAll<PublisherRow>(
      `SELECT user_id,key_id,public_key_pem,label,created_at,revoked_at FROM agent_publisher_keys WHERE user_id=? ORDER BY created_at DESC,key_id`,
      [userId],
    );
    return rows.map(mapPublisher);
  }

  async getPublisherKey(userId: number, keyId: string): Promise<TrustedPublisherKey | null> {
    const row = await this.db.queryOne<PublisherRow>(
      `SELECT user_id,key_id,public_key_pem,label,created_at,revoked_at FROM agent_publisher_keys WHERE user_id=? AND key_id=?`,
      [userId, keyId],
    );
    return row ? mapPublisher(row) : null;
  }

  async putPublisherKey(record: TrustedPublisherKey): Promise<void> {
    await this.db.execute(
      `INSERT INTO agent_publisher_keys(user_id,key_id,public_key_pem,label,created_at,revoked_at) VALUES(?,?,?,?,?,NULL)
       ON CONFLICT(user_id,key_id) DO UPDATE SET
         public_key_pem=excluded.public_key_pem,label=excluded.label,revoked_at=NULL`,
      [record.userId, record.keyId, record.publicKeyPem, record.label, record.createdAt],
    );
  }

  async revokePublisherKey(userId: number, keyId: string, revokedAt: number): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE agent_publisher_keys SET revoked_at=? WHERE user_id=? AND key_id=? AND revoked_at IS NULL`,
      [revokedAt, userId, keyId],
    );
    return result.changes === 1;
  }

  async createStage(record: PluginStageRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO agent_plugin_stages
       (id,user_id,artifact_app_id,artifact_id,package_hash,size_bytes,publisher_key_id,app_id,app_version,manifest_json,status,error_code,created_at,updated_at,version)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        record.id,
        record.userId,
        record.artifactAppId,
        record.artifactId,
        record.packageHash,
        record.sizeBytes,
        record.publisherKeyId,
        record.appId,
        record.version,
        record.manifest ? JSON.stringify(record.manifest) : null,
        record.status,
        record.errorCode,
        record.createdAt,
        record.updatedAt,
        record.versionNumber,
      ],
    );
  }

  async getStage(userId: number, stageId: string): Promise<PluginStageRecord | null> {
    const row = await this.db.queryOne<StageRow>(
      `SELECT ${STAGE_COLUMNS} FROM agent_plugin_stages WHERE id=? AND user_id=?`,
      [stageId, userId],
    );
    return row ? mapStage(row) : null;
  }

  async listStages(): Promise<PluginStageRecord[]> {
    const rows = await this.db.queryAll<StageRow>(`SELECT ${STAGE_COLUMNS} FROM agent_plugin_stages ORDER BY id`);
    return rows.map(mapStage);
  }

  async updateStage(
    userId: number,
    stageId: string,
    expectedVersion: number,
    patch: Partial<
      Pick<
        PluginStageRecord,
        'publisherKeyId' | 'appId' | 'version' | 'manifest' | 'status' | 'errorCode' | 'updatedAt'
      >
    >,
  ): Promise<PluginStageRecord> {
    const current = await this.getStage(userId, stageId);
    if (!current) throw new Error('PLUGIN_STAGE_NOT_FOUND');
    const next = { ...current, ...patch };
    const result = await this.db.execute(
      `UPDATE agent_plugin_stages SET publisher_key_id=?,app_id=?,app_version=?,manifest_json=?,status=?,error_code=?,updated_at=?,version=version+1
       WHERE id=? AND user_id=? AND version=?`,
      [
        next.publisherKeyId,
        next.appId,
        next.version,
        next.manifest ? JSON.stringify(next.manifest) : null,
        next.status,
        next.errorCode,
        next.updatedAt,
        stageId,
        userId,
        expectedVersion,
      ],
    );
    if (result.changes !== 1) throw new Error('PLUGIN_STAGE_VERSION_CONFLICT');
    const updated = await this.getStage(userId, stageId);
    if (!updated) throw new Error('PLUGIN_STAGE_NOT_FOUND');
    return updated;
  }

  async upsertVersion(record: PluginVersionRecord): Promise<void> {
    const existing = await this.getVersion(record.appId, record.version);
    if (existing && existing.packageHash !== record.packageHash) throw new Error('PLUGIN_VERSION_IMMUTABLE');
    await this.db.execute(
      `INSERT INTO agent_plugin_versions
       (app_id,version,package_hash,publisher_key_id,manifest_json,frontend_entry,backend_entry,runner_entry,skill_files_json,status,installed_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(app_id,version) DO UPDATE SET
         status=CASE
           WHEN agent_plugin_versions.status='installed' AND excluded.status='verified' THEN 'installed'
           ELSE excluded.status
         END,
         installed_at=CASE
           WHEN agent_plugin_versions.status='installed' AND excluded.status='verified' THEN agent_plugin_versions.installed_at
           ELSE excluded.installed_at
         END,
         updated_at=excluded.updated_at`,
      [
        record.appId,
        record.version,
        record.packageHash,
        record.publisherKeyId,
        JSON.stringify(record.manifest),
        record.frontendEntry,
        record.backendEntry,
        record.runnerEntry,
        JSON.stringify(record.skillFiles),
        record.status,
        record.installedAt,
        record.updatedAt,
      ],
    );
  }

  async getVersion(appId: string, version: string): Promise<PluginVersionRecord | null> {
    const row = await this.db.queryOne<VersionRow>(
      `SELECT ${VERSION_COLUMNS} FROM agent_plugin_versions WHERE app_id=? AND version=?`,
      [appId, version],
    );
    return row ? mapVersion(row) : null;
  }

  async listVersions(appId?: string): Promise<PluginVersionRecord[]> {
    const rows = appId
      ? await this.db.queryAll<VersionRow>(
          `SELECT ${VERSION_COLUMNS} FROM agent_plugin_versions WHERE app_id=? ORDER BY installed_at DESC,version DESC`,
          [appId],
        )
      : await this.db.queryAll<VersionRow>(
          `SELECT ${VERSION_COLUMNS} FROM agent_plugin_versions ORDER BY app_id,installed_at DESC,version DESC`,
        );
    return rows.map(mapVersion);
  }

  async listVersionsForUser(userId: number, appId?: string): Promise<PluginVersionRecord[]> {
    const rows = appId
      ? await this.db.queryAll<VersionRow>(
          `SELECT v.${VERSION_COLUMNS.split(',').join(',v.')}
           FROM agent_plugin_versions v
           JOIN agent_plugin_installations i ON i.app_id=v.app_id AND i.version=v.version
           WHERE i.user_id=? AND i.status='installed' AND v.app_id=?
           ORDER BY v.installed_at DESC,v.version DESC`,
          [userId, appId],
        )
      : await this.db.queryAll<VersionRow>(
          `SELECT v.${VERSION_COLUMNS.split(',').join(',v.')}
           FROM agent_plugin_versions v
           JOIN agent_plugin_installations i ON i.app_id=v.app_id AND i.version=v.version
           WHERE i.user_id=? AND i.status='installed'
           ORDER BY v.app_id,v.installed_at DESC,v.version DESC`,
          [userId],
        );
    return rows.map(mapVersion);
  }

  async updateVersionStatus(
    appId: string,
    version: string,
    status: PluginVersionStatus,
    installedAt: number | null,
    updatedAt: number,
  ): Promise<void> {
    const result = await this.db.execute(
      `UPDATE agent_plugin_versions SET status=?,installed_at=?,updated_at=? WHERE app_id=? AND version=?`,
      [status, installedAt, updatedAt, appId, version],
    );
    if (result.changes !== 1) throw new Error('PLUGIN_VERSION_NOT_FOUND');
  }

  async getInstallation(userId: number, appId: string): Promise<PluginInstallationRecord | null> {
    const row = await this.db.queryOne<InstallationRow>(
      `SELECT user_id,app_id,version,status,created_at,updated_at
       FROM agent_plugin_installations WHERE user_id=? AND app_id=?`,
      [userId, appId],
    );
    return row ? mapInstallation(row) : null;
  }

  async listInstallations(userId: number): Promise<PluginInstallationRecord[]> {
    const rows = await this.db.queryAll<InstallationRow>(
      `SELECT user_id,app_id,version,status,created_at,updated_at
       FROM agent_plugin_installations WHERE user_id=? ORDER BY updated_at DESC,app_id`,
      [userId],
    );
    return rows.map(mapInstallation);
  }

  async listActiveInstallations(): Promise<PluginInstallationRecord[]> {
    const rows = await this.db.queryAll<InstallationRow>(
      `SELECT user_id,app_id,version,status,created_at,updated_at
       FROM agent_plugin_installations WHERE status='installed' ORDER BY user_id,app_id`,
    );
    return rows.map(mapInstallation);
  }

  async upsertInstallation(record: PluginInstallationRecord): Promise<void> {
    await this.db.execute(
      `INSERT INTO agent_plugin_installations(user_id,app_id,version,status,created_at,updated_at)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(user_id,app_id) DO UPDATE SET
         version=excluded.version,status=excluded.status,updated_at=excluded.updated_at`,
      [record.userId, record.appId, record.version, record.status, record.createdAt, record.updatedAt],
    );
  }

  async activateInstallation(
    userId: number,
    appId: string,
    fromVersion: string,
    toVersion: string,
    expectedAppStateVersion: number,
    observedState: AppRecord['observedState'],
    updatedAt: number,
  ): Promise<AppRecord> {
    let updated: AppStateRow | null = null;
    await this.db.transaction(async (tx) => {
      const appResult = await tx.execute(
        `UPDATE agent_apps SET
           active_version=?,observed_state=?,health_reason=NULL,accept_new_runs=1,
           policy_revision=policy_revision+1,version=version+1,updated_at=?
         WHERE user_id=? AND app_id=? AND active_version=? AND version=? AND running_count=0`,
        [toVersion, observedState, updatedAt, userId, appId, fromVersion, expectedAppStateVersion],
      );
      if (appResult.changes !== 1) throw new Error('APP_STATE_VERSION_CONFLICT');
      const currentInstallation = await tx.queryOne<InstallationRow>(
        `SELECT user_id,app_id,version,status,created_at,updated_at
         FROM agent_plugin_installations WHERE user_id=? AND app_id=?`,
        [userId, appId],
      );
      if (!currentInstallation || currentInstallation.version !== fromVersion) {
        throw new Error('PLUGIN_INSTALLATION_STATE_CONFLICT');
      }
      const installationResult = await tx.execute(
        `UPDATE agent_plugin_installations SET version=?,status='installed',updated_at=?
         WHERE user_id=? AND app_id=? AND version=? AND status IN ('installed','removed')`,
        [toVersion, updatedAt, userId, appId, fromVersion],
      );
      if (installationResult.changes !== 1) throw new Error('PLUGIN_INSTALLATION_STATE_CONFLICT');
      updated = await tx.queryOne<AppStateRow>(
        `SELECT ${APP_STATE_COLUMNS} FROM agent_apps WHERE user_id=? AND app_id=?`,
        [userId, appId],
      );
      if (!updated) throw new Error('AGENT_APP_NOT_FOUND');
      const app = mapAppState(updated);
      await appendHostEvent(tx, userId, 'app.changed', appChangedPayload(app), updatedAt);
      await appendHostEvent(
        tx,
        userId,
        'authorization.changed',
        { appId, policyRevision: app.policyRevision },
        updatedAt,
      );
    });
    if (!updated) throw new Error('AGENT_APP_NOT_FOUND');
    return mapAppState(updated);
  }

  async removeInstallation(
    userId: number,
    appId: string,
    version: string,
    expectedAppStateVersion: number,
    updatedAt: number,
  ): Promise<AppRecord> {
    let updated: AppStateRow | null = null;
    await this.db.transaction(async (tx) => {
      const appResult = await tx.execute(
        `UPDATE agent_apps SET
           desired_state='disabled',observed_state='disabled',health_reason='PLUGIN_UNINSTALLED',accept_new_runs=0,
           policy_revision=policy_revision+1,version=version+1,updated_at=?
         WHERE user_id=? AND app_id=? AND active_version=? AND version=? AND running_count=0`,
        [updatedAt, userId, appId, version, expectedAppStateVersion],
      );
      if (appResult.changes !== 1) throw new Error('APP_STATE_VERSION_CONFLICT');
      const installationResult = await tx.execute(
        `UPDATE agent_plugin_installations SET status='removed',updated_at=?
         WHERE user_id=? AND app_id=? AND version=? AND status='installed'`,
        [updatedAt, userId, appId, version],
      );
      if (installationResult.changes !== 1) throw new Error('PLUGIN_INSTALLATION_STATE_CONFLICT');
      updated = await tx.queryOne<AppStateRow>(
        `SELECT ${APP_STATE_COLUMNS} FROM agent_apps WHERE user_id=? AND app_id=?`,
        [userId, appId],
      );
      if (!updated) throw new Error('AGENT_APP_NOT_FOUND');
      const app = mapAppState(updated);
      await appendHostEvent(tx, userId, 'app.changed', appChangedPayload(app), updatedAt);
      await appendHostEvent(
        tx,
        userId,
        'authorization.changed',
        { appId, policyRevision: app.policyRevision },
        updatedAt,
      );
    });
    if (!updated) throw new Error('AGENT_APP_NOT_FOUND');
    return mapAppState(updated);
  }

  async countInstalled(appId: string, version: string): Promise<number> {
    const row = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM agent_plugin_installations
       WHERE app_id=? AND version=? AND status='installed'`,
      [appId, version],
    );
    return row?.count ?? 0;
  }
}
