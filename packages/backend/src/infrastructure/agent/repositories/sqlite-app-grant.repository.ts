import type { AppGrantRepositoryPort } from '../../../modules/agent/host/app-grant.repository.port';
import { CapabilityRegistry } from '../../../modules/agent/host/capability-registry';
import type { CapabilityGrant } from '../../../modules/agent/host/capability.types';
import type { Scope } from '../../../modules/agent/agent.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { appendHostEvent } from '../events/host-event-outbox';
import { parseDurableJsonValue } from '../runtime/durable-state-decoders';

interface GrantRow {
  capability: CapabilityGrant['capability'];
  schema_version: number;
  scope_json: string;
  granted_at: number;
}

export class SqliteAppGrantRepository implements AppGrantRepositoryPort {
  constructor(
    private readonly db: RelationalDatabase,
    private readonly capabilities: CapabilityRegistry,
  ) {}

  private mapRow(row: GrantRow): CapabilityGrant {
    try {
      return this.capabilities.parseGrant({
        capability: row.capability,
        schemaVersion: row.schema_version,
        scope: parseDurableJsonValue(row.scope_json),
        grantedAt: row.granted_at,
      });
    } catch {
      throw new Error('AGENT_DURABLE_STATE_INVALID');
    }
  }

  async list(scope: Scope): Promise<CapabilityGrant[]> {
    const rows = await this.db.queryAll<GrantRow>(
      `SELECT capability, schema_version, scope_json, granted_at
       FROM agent_app_grants WHERE user_id = ? AND app_id = ? ORDER BY capability`,
      [scope.userId, scope.appId],
    );
    return rows.map((row) => this.mapRow(row));
  }

  async insertDefaults(scope: Scope, grants: readonly CapabilityGrant[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const grant of grants) {
        await tx.execute(
          `INSERT OR IGNORE INTO agent_app_grants
            (user_id, app_id, capability, schema_version, scope_json, granted_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            scope.userId,
            scope.appId,
            grant.capability,
            grant.schemaVersion,
            JSON.stringify(grant.scope),
            grant.grantedAt,
          ],
        );
      }
    });
  }

  async replace(scope: Scope, expectedPolicyRevision: number, grants: readonly CapabilityGrant[]): Promise<number> {
    const updatedAt = Math.floor(Date.now() / 1000);
    return this.db.transaction(async (tx) => {
      const app = await tx.queryOne<{ policy_revision: number }>(
        'SELECT policy_revision FROM agent_apps WHERE user_id = ? AND app_id = ?',
        [scope.userId, scope.appId],
      );
      if (!app) throw new Error('AGENT_APP_NOT_FOUND');
      if (app.policy_revision !== expectedPolicyRevision) throw new Error('APP_POLICY_VERSION_CONFLICT');

      await tx.execute('DELETE FROM agent_app_grants WHERE user_id = ? AND app_id = ?', [scope.userId, scope.appId]);
      for (const grant of grants) {
        await tx.execute(
          `INSERT INTO agent_app_grants
            (user_id, app_id, capability, schema_version, scope_json, granted_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            scope.userId,
            scope.appId,
            grant.capability,
            grant.schemaVersion,
            JSON.stringify(grant.scope),
            grant.grantedAt,
          ],
        );
      }

      const nextRevision = expectedPolicyRevision + 1;
      const result = await tx.execute(
        `UPDATE agent_apps
         SET policy_revision = ?, version = version + 1, updated_at = ?
         WHERE user_id = ? AND app_id = ? AND policy_revision = ?`,
        [nextRevision, updatedAt, scope.userId, scope.appId, expectedPolicyRevision],
      );
      if (result.changes !== 1) throw new Error('APP_POLICY_VERSION_CONFLICT');
      await appendHostEvent(
        tx,
        scope.userId,
        'authorization.changed',
        { appId: scope.appId, policyRevision: nextRevision, capabilities: grants.map((grant) => grant.capability) },
        updatedAt,
      );
      return nextRevision;
    });
  }
}
