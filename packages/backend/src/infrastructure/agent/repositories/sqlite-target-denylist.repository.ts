import type {
  TargetDenylistEntry,
  TargetDenylistRepositoryPort,
  TargetDenylistSnapshot,
} from '../../../modules/agent/host/target-denylist.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { appendHostEvent } from '../events/host-event-outbox';

interface DenylistRow {
  connection_id: number;
  reason: string;
  changed_by: number;
  changed_at: number;
}

const mapRow = (row: DenylistRow): TargetDenylistEntry => ({
  connectionId: row.connection_id,
  reason: row.reason,
  changedBy: row.changed_by,
  changedAt: row.changed_at,
});

const listEntries = async (db: RelationalDatabase): Promise<TargetDenylistEntry[]> => {
  const rows = await db.queryAll<DenylistRow>(
    `SELECT connection_id, reason, changed_by, changed_at
     FROM agent_target_denylist ORDER BY connection_id`,
  );
  return rows.map(mapRow);
};

export class SqliteTargetDenylistRepository implements TargetDenylistRepositoryPort {
  constructor(private readonly db: RelationalDatabase) {}

  async isDenied(connectionId: number): Promise<boolean> {
    return Boolean(
      await this.db.queryOne<{ connection_id: number }>(
        'SELECT connection_id FROM agent_target_denylist WHERE connection_id = ?',
        [connectionId],
      ),
    );
  }

  list(): Promise<TargetDenylistEntry[]> {
    return listEntries(this.db);
  }

  async snapshot(): Promise<TargetDenylistSnapshot> {
    const meta = await this.db.queryOne<{ revision: number }>(
      'SELECT revision FROM agent_target_denylist_meta WHERE id = 1',
    );
    if (!meta) throw new Error('TARGET_DENYLIST_META_UNAVAILABLE');
    return { revision: meta.revision, entries: await listEntries(this.db) };
  }

  async replace(
    expectedRevision: number,
    connectionIds: readonly number[],
    reason: string,
    changedBy: number,
    changedAt: number,
  ): Promise<TargetDenylistSnapshot> {
    return this.db.transaction(async (tx) => {
      const meta = await tx.queryOne<{ revision: number }>(
        'SELECT revision FROM agent_target_denylist_meta WHERE id = 1',
      );
      if (!meta) throw new Error('TARGET_DENYLIST_META_UNAVAILABLE');
      if (meta.revision !== expectedRevision) throw new Error('TARGET_DENYLIST_VERSION_CONFLICT');

      if (connectionIds.length > 0) {
        const placeholders = connectionIds.map(() => '?').join(',');
        const existing = await tx.queryAll<{ id: number }>(`SELECT id FROM connections WHERE id IN (${placeholders})`, [
          ...connectionIds,
        ]);
        if (existing.length !== connectionIds.length) throw new Error('TARGET_CONNECTION_NOT_FOUND');
      }

      const nextRevision = expectedRevision + 1;
      const advanced = await tx.execute(
        `UPDATE agent_target_denylist_meta SET revision = ?, updated_at = ?
         WHERE id = 1 AND revision = ?`,
        [nextRevision, changedAt, expectedRevision],
      );
      if (advanced.changes !== 1) throw new Error('TARGET_DENYLIST_VERSION_CONFLICT');

      await tx.execute('DELETE FROM agent_target_denylist');
      for (const connectionId of connectionIds) {
        await tx.execute(
          `INSERT INTO agent_target_denylist (connection_id, reason, changed_by, changed_at)
           VALUES (?, ?, ?, ?)`,
          [connectionId, reason, changedBy, changedAt],
        );
      }

      const eventCursor = await appendHostEvent(
        tx,
        changedBy,
        'authorization.changed',
        { revision: nextRevision, connectionIds: [...connectionIds] },
        changedAt,
      );
      return {
        revision: nextRevision,
        entries: await listEntries(tx),
        eventCursor,
      };
    });
  }
}
