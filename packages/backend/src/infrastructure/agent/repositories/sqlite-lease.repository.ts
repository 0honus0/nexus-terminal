import { randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../modules/agent/agent.types';
import type {
  LeaseMode,
  LeaseOwner,
  LeasePort,
  ResourceLease,
  ResourceQuarantine,
} from '../../../modules/agent/capabilities/lease.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

const DEFAULT_TTL_SECONDS = 30;
const MAX_KEYS = 64;

interface LeaseRow {
  id: string;
  resource_key: string;
  mode: LeaseMode;
  owner_type: LeaseOwner['type'];
  owner_id: string;
  fence: number;
  acquired_at: number;
  expires_at: number;
  active_mutation: number;
  operation_id: string | null;
}

interface QuarantineRow {
  resource_key: string;
  tool_call_id: string | null;
  owner_type: LeaseOwner['type'];
  owner_id: string;
  reason: string;
  evidence_json: string;
  version: number;
  created_at: number;
}

const normalizeKeys = (values: readonly string[]): string[] => {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_KEYS) throw new Error('VALIDATION_FAILED');
  const keys = [...new Set(values.map((value) => value.trim()))].sort();
  if (keys.some((value) => value.length < 1 || value.length > 1024 || /[\r\n\0]/.test(value))) {
    throw new Error('VALIDATION_FAILED');
  }
  return keys;
};

const ttl = (value = DEFAULT_TTL_SECONDS): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 300) throw new Error('VALIDATION_FAILED');
  return value;
};

const assertOwner = (owner: LeaseOwner): void => {
  if (!owner || !['agent', 'workspace', 'system'].includes(owner.type) || !owner.id || owner.id.length > 256) {
    throw new Error('VALIDATION_FAILED');
  }
};

const mapLease = (row: LeaseRow): ResourceLease => ({
  id: row.id,
  resourceKey: row.resource_key,
  mode: row.mode,
  owner: { type: row.owner_type, id: row.owner_id },
  fence: row.fence,
  acquiredAt: row.acquired_at,
  expiresAt: row.expires_at,
  activeMutation: row.active_mutation === 1,
  operationId: row.operation_id,
});

const mapQuarantine = (row: QuarantineRow): ResourceQuarantine => ({
  resourceKey: row.resource_key,
  toolCallId: row.tool_call_id,
  owner: { type: row.owner_type, id: row.owner_id },
  reason: row.reason,
  evidence: JSON.parse(row.evidence_json) as JsonValue,
  version: row.version,
  createdAt: row.created_at,
});

export class SqliteLeaseRepository implements LeasePort {
  constructor(private readonly db: RelationalDatabase) {}

  async acquireMany(
    owner: LeaseOwner,
    resourceKeys: readonly string[],
    mode: LeaseMode,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<ResourceLease[]> {
    assertOwner(owner);
    if (mode !== 'read' && mode !== 'write') throw new Error('VALIDATION_FAILED');
    const keys = normalizeKeys(resourceKeys);
    const duration = ttl(ttlSeconds);
    const now = Math.floor(Date.now() / 1000);
    return this.db.transaction(async (tx) => {
      for (const key of keys) {
        await tx.execute('INSERT OR IGNORE INTO agent_resource_fences(resource_key, next_fence) VALUES (?, 1)', [key]);
        await this.quarantineExpiredMutations(tx, key, now);
        await tx.execute(
          'DELETE FROM agent_leases WHERE resource_key = ? AND expires_at <= ? AND active_mutation = 0',
          [key, now],
        );
        const quarantined = await tx.queryOne<{ resource_key: string }>(
          'SELECT resource_key FROM agent_resource_quarantine WHERE resource_key = ?',
          [key],
        );
        if (quarantined) throw new Error('RESOURCE_QUARANTINED');
        const active = await tx.queryAll<LeaseRow>(
          `SELECT id, resource_key, mode, owner_type, owner_id, fence, acquired_at, expires_at, active_mutation, operation_id
           FROM agent_leases WHERE resource_key = ? AND expires_at > ?`,
          [key, now],
        );
        if (active.some((row) => row.owner_type === owner.type && row.owner_id === owner.id)) {
          throw new Error('LEASE_REENTRANT');
        }
        const conflict = mode === 'write' ? active.length > 0 : active.some((row) => row.mode === 'write');
        if (conflict) throw new Error('LEASE_CONFLICT');
      }

      const leases: ResourceLease[] = [];
      for (const key of keys) {
        const fenceRow = await tx.queryOne<{ next_fence: number }>(
          'SELECT next_fence FROM agent_resource_fences WHERE resource_key = ?',
          [key],
        );
        if (!fenceRow) throw new Error('LEASE_STATE_INVALID');
        const id = randomUUID();
        const fence = fenceRow.next_fence;
        await tx.execute('UPDATE agent_resource_fences SET next_fence = next_fence + 1 WHERE resource_key = ?', [key]);
        await tx.execute(
          `INSERT INTO agent_leases
            (id, resource_key, mode, owner_type, owner_id, fence, acquired_at, expires_at, active_mutation, operation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
          [id, key, mode, owner.type, owner.id, fence, now, now + duration],
        );
        leases.push({
          id,
          resourceKey: key,
          mode,
          owner: { ...owner },
          fence,
          acquiredAt: now,
          expiresAt: now + duration,
          activeMutation: false,
          operationId: null,
        });
      }
      return leases;
    });
  }

  async renew(
    leaseIds: readonly string[],
    owner: LeaseOwner,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<ResourceLease[]> {
    assertOwner(owner);
    const ids = this.normalizeIds(leaseIds);
    const duration = ttl(ttlSeconds);
    const now = Math.floor(Date.now() / 1000);
    return this.db.transaction(async (tx) => {
      for (const id of ids) {
        const changed = await tx.execute(
          `UPDATE agent_leases SET expires_at = ?
           WHERE id = ? AND owner_type = ? AND owner_id = ? AND expires_at > ?
             AND NOT EXISTS (SELECT 1 FROM agent_resource_quarantine q WHERE q.resource_key = agent_leases.resource_key)`,
          [now + duration, id, owner.type, owner.id, now],
        );
        if (changed.changes !== 1) throw new Error('LEASE_LOST');
      }
      const rows = await tx.queryAll<LeaseRow>(
        `SELECT id, resource_key, mode, owner_type, owner_id, fence, acquired_at, expires_at, active_mutation, operation_id
         FROM agent_leases WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids,
      );
      if (rows.length !== ids.length) throw new Error('LEASE_LOST');
      return rows.map(mapLease).sort((a, b) => a.resourceKey.localeCompare(b.resourceKey));
    });
  }

  async markMutationActive(leaseIds: readonly string[], owner: LeaseOwner, operationId: string): Promise<void> {
    assertOwner(owner);
    if (!operationId || operationId.length > 256) throw new Error('VALIDATION_FAILED');
    const ids = this.normalizeIds(leaseIds);
    const now = Math.floor(Date.now() / 1000);
    await this.db.transaction(async (tx) => {
      for (const id of ids) {
        const changed = await tx.execute(
          `UPDATE agent_leases SET active_mutation = 1, operation_id = ?
           WHERE id = ? AND owner_type = ? AND owner_id = ? AND mode = 'write' AND expires_at > ? AND active_mutation = 0`,
          [operationId, id, owner.type, owner.id, now],
        );
        if (changed.changes !== 1) throw new Error('LEASE_LOST');
      }
    });
  }

  async markMutationSettled(leaseIds: readonly string[], owner: LeaseOwner, operationId: string): Promise<void> {
    assertOwner(owner);
    const ids = this.normalizeIds(leaseIds);
    await this.db.transaction(async (tx) => {
      for (const id of ids) {
        const changed = await tx.execute(
          `UPDATE agent_leases SET active_mutation = 0, operation_id = NULL
           WHERE id = ? AND owner_type = ? AND owner_id = ? AND active_mutation = 1 AND operation_id = ?`,
          [id, owner.type, owner.id, operationId],
        );
        if (changed.changes !== 1) throw new Error('LEASE_LOST');
      }
    });
  }

  async release(leaseIds: readonly string[], owner: LeaseOwner): Promise<void> {
    assertOwner(owner);
    const ids = this.normalizeIds(leaseIds);
    await this.db.transaction(async (tx) => {
      for (const id of ids) {
        const row = await tx.queryOne<LeaseRow>(
          `SELECT id, resource_key, mode, owner_type, owner_id, fence, acquired_at, expires_at, active_mutation, operation_id
           FROM agent_leases WHERE id = ?`,
          [id],
        );
        if (!row) continue;
        if (row.owner_type !== owner.type || row.owner_id !== owner.id) throw new Error('RESOURCE_FORBIDDEN');
        if (row.active_mutation === 1) throw new Error('LEASE_MUTATION_ACTIVE');
        await tx.execute('DELETE FROM agent_leases WHERE id = ?', [id]);
      }
    });
  }

  async quarantine(
    owner: LeaseOwner,
    resourceKeys: readonly string[],
    reason: string,
    evidence: JsonValue,
    toolCallId?: string,
  ): Promise<ResourceQuarantine[]> {
    assertOwner(owner);
    const keys = normalizeKeys(resourceKeys);
    if (!reason || reason.length > 512) throw new Error('VALIDATION_FAILED');
    const evidenceJson = JSON.stringify(evidence);
    if (Buffer.byteLength(evidenceJson, 'utf8') > 64 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
    const now = Math.floor(Date.now() / 1000);
    return this.db.transaction(async (tx) => {
      for (const key of keys) {
        await tx.execute('INSERT OR IGNORE INTO agent_resource_fences(resource_key, next_fence) VALUES (?, 1)', [key]);
        await tx.execute(
          `INSERT INTO agent_resource_quarantine
            (resource_key, tool_call_id, owner_type, owner_id, reason, evidence_json, version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT(resource_key) DO UPDATE SET
             tool_call_id = excluded.tool_call_id,
             owner_type = excluded.owner_type,
             owner_id = excluded.owner_id,
             reason = excluded.reason,
             evidence_json = excluded.evidence_json,
             version = agent_resource_quarantine.version + 1,
             created_at = excluded.created_at`,
          [key, toolCallId ?? null, owner.type, owner.id, reason, evidenceJson, now],
        );
      }
      const rows = await tx.queryAll<QuarantineRow>(
        `SELECT resource_key, tool_call_id, owner_type, owner_id, reason, evidence_json, version, created_at
         FROM agent_resource_quarantine WHERE resource_key IN (${keys.map(() => '?').join(',')})`,
        keys,
      );
      return rows.map(mapQuarantine).sort((a, b) => a.resourceKey.localeCompare(b.resourceKey));
    });
  }

  async getQuarantine(resourceKey: string): Promise<ResourceQuarantine | null> {
    const [key] = normalizeKeys([resourceKey]);
    const row = await this.db.queryOne<QuarantineRow>(
      `SELECT resource_key, tool_call_id, owner_type, owner_id, reason, evidence_json, version, created_at
       FROM agent_resource_quarantine WHERE resource_key = ?`,
      [key],
    );
    return row ? mapQuarantine(row) : null;
  }

  async resolveQuarantine(resourceKey: string, expectedVersion: number): Promise<void> {
    const [key] = normalizeKeys([resourceKey]);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('VALIDATION_FAILED');
    const changed = await this.db.execute(
      'DELETE FROM agent_resource_quarantine WHERE resource_key = ? AND version = ?',
      [key, expectedVersion],
    );
    if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
  }

  private normalizeIds(values: readonly string[]): string[] {
    if (!Array.isArray(values) || values.length < 1 || values.length > MAX_KEYS) throw new Error('VALIDATION_FAILED');
    const ids = [...new Set(values)];
    if (ids.some((value) => typeof value !== 'string' || value.length < 1 || value.length > 128)) {
      throw new Error('VALIDATION_FAILED');
    }
    return ids;
  }

  private async quarantineExpiredMutations(tx: RelationalDatabase, key: string, now: number): Promise<void> {
    const expired = await tx.queryAll<LeaseRow>(
      `SELECT id, resource_key, mode, owner_type, owner_id, fence, acquired_at, expires_at, active_mutation, operation_id
       FROM agent_leases WHERE resource_key = ? AND expires_at <= ? AND active_mutation = 1`,
      [key, now],
    );
    for (const row of expired) {
      await tx.execute(
        `INSERT OR IGNORE INTO agent_resource_quarantine
          (resource_key, tool_call_id, owner_type, owner_id, reason, evidence_json, version, created_at)
         VALUES (?, NULL, ?, ?, 'LEASE_EXPIRED_DURING_MUTATION', ?, 1, ?)`,
        [
          key,
          row.owner_type,
          row.owner_id,
          JSON.stringify({ leaseId: row.id, operationId: row.operation_id, fence: row.fence }),
          now,
        ],
      );
    }
  }
}
