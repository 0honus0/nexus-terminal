import type { AppStoragePort, AppStorageRecord, JsonValue, Scope } from '../../../modules/agent/host/app-storage.port';
import type {
  AppStorageSnapshot,
  AppStorageSnapshotPort,
  AppStorageStats,
} from '../../../modules/agent/host/app-storage-snapshot.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { parseDurableJsonValue } from '../runtime/durable-state-decoders';

const MAX_VALUE_BYTES = 64 * 1024;
const MAX_APP_BYTES = 16 * 1024 * 1024;
const MAX_APP_ENTRIES = 4096;
const APP_STORAGE_ENTRY_OVERHEAD_BYTES = 128;

const chargedBytes = (key: string, valueBytes: number): number =>
  Buffer.byteLength(key, 'utf8') + valueBytes + APP_STORAGE_ENTRY_OVERHEAD_BYTES;

interface StorageRow {
  key: string;
  value_json: string;
  bytes: number;
  version: number;
  updated_at: number;
}

const mapRow = (row: StorageRow): AppStorageRecord => ({
  key: row.key,
  value: parseDurableJsonValue(row.value_json),
  bytes: row.bytes,
  version: row.version,
  updatedAt: row.updated_at,
});

const validateKey = (key: string): void => {
  if (key.length < 1 || Buffer.byteLength(key, 'utf8') > 256) throw new Error('APP_STORAGE_KEY_INVALID');
};

export class SqliteAppStorageRepository implements AppStoragePort, AppStorageSnapshotPort {
  constructor(private readonly db: RelationalDatabase) {}

  async get(scope: Scope, key: string): Promise<AppStorageRecord | null> {
    validateKey(key);
    const row = await this.db.queryOne<StorageRow>(
      `SELECT key, value_json, bytes, version, updated_at
       FROM agent_app_storage WHERE user_id = ? AND app_id = ? AND key = ?`,
      [scope.userId, scope.appId, key],
    );
    return row ? mapRow(row) : null;
  }

  async put(scope: Scope, key: string, value: JsonValue, expectedVersion: number | null): Promise<AppStorageRecord> {
    validateKey(key);
    const serialized = JSON.stringify(value);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes > MAX_VALUE_BYTES) throw new Error('APP_STORAGE_VALUE_TOO_LARGE');

    await this.db.transaction(async (tx) => {
      const current = await tx.queryOne<{ bytes: number; version: number }>(
        `SELECT bytes, version FROM agent_app_storage
         WHERE user_id = ? AND app_id = ? AND key = ?`,
        [scope.userId, scope.appId, key],
      );

      if (expectedVersion === null) {
        if (current) throw new Error('APP_STORAGE_VERSION_CONFLICT');
      } else if (!current || current.version !== expectedVersion) {
        throw new Error('APP_STORAGE_VERSION_CONFLICT');
      }

      const usage = await tx.queryOne<{ entry_count: number; charged_total: number }>(
        `SELECT COUNT(*) AS entry_count,
                COALESCE(SUM(bytes + length(CAST(key AS BLOB)) + ${APP_STORAGE_ENTRY_OVERHEAD_BYTES}), 0)
                  AS charged_total
         FROM agent_app_storage
         WHERE user_id = ? AND app_id = ?`,
        [scope.userId, scope.appId],
      );
      const nextEntryCount = (usage?.entry_count ?? 0) + (current ? 0 : 1);
      const nextChargedTotal =
        (usage?.charged_total ?? 0) - (current ? chargedBytes(key, current.bytes) : 0) + chargedBytes(key, bytes);
      if (nextEntryCount > MAX_APP_ENTRIES || nextChargedTotal > MAX_APP_BYTES) {
        throw new Error('APP_STORAGE_QUOTA_EXCEEDED');
      }

      const now = Math.floor(Date.now() / 1000);
      if (!current) {
        await tx.execute(
          `INSERT INTO agent_app_storage (user_id, app_id, key, value_json, bytes, version, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
          [scope.userId, scope.appId, key, serialized, bytes, now],
        );
      } else {
        const result = await tx.execute(
          `UPDATE agent_app_storage
           SET value_json = ?, bytes = ?, version = version + 1, updated_at = ?
           WHERE user_id = ? AND app_id = ? AND key = ? AND version = ?`,
          [serialized, bytes, now, scope.userId, scope.appId, key, expectedVersion],
        );
        if (result.changes !== 1) throw new Error('APP_STORAGE_VERSION_CONFLICT');
      }
    });

    const updated = await this.get(scope, key);
    if (!updated) throw new Error('APP_STORAGE_NOT_FOUND');
    return updated;
  }

  async delete(scope: Scope, key: string, expectedVersion: number): Promise<boolean> {
    validateKey(key);
    const result = await this.db.execute(
      `DELETE FROM agent_app_storage
       WHERE user_id = ? AND app_id = ? AND key = ? AND version = ?`,
      [scope.userId, scope.appId, key, expectedVersion],
    );
    if (result.changes === 1) return true;
    if (await this.get(scope, key)) throw new Error('APP_STORAGE_VERSION_CONFLICT');
    return false;
  }

  async stats(scope: Scope): Promise<AppStorageStats> {
    const row = await this.db.queryOne<{ entry_count: number; total_bytes: number }>(
      `SELECT COUNT(*) AS entry_count, COALESCE(SUM(bytes), 0) AS total_bytes
       FROM agent_app_storage WHERE user_id=? AND app_id=?`,
      [scope.userId, scope.appId],
    );
    return { entryCount: row?.entry_count ?? 0, totalBytes: row?.total_bytes ?? 0 };
  }

  async capture(scope: Scope): Promise<AppStorageSnapshot> {
    const rows = await this.db.queryAll<StorageRow>(
      `SELECT key,value_json,bytes,version,updated_at FROM agent_app_storage
       WHERE user_id=? AND app_id=? ORDER BY key`,
      [scope.userId, scope.appId],
    );
    const entries = rows.map(mapRow);
    return { entries, totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0) };
  }

  async restore(scope: Scope, snapshot: AppStorageSnapshot): Promise<void> {
    if (snapshot.entries.length > MAX_APP_ENTRIES || snapshot.totalBytes > MAX_APP_BYTES) {
      throw new Error('APP_STORAGE_SNAPSHOT_INVALID');
    }
    const seenKeys = new Set<string>();
    const prepared: Array<{ entry: AppStorageSnapshot['entries'][number]; serialized: string; bytes: number }> = [];
    let totalBytes = 0;
    let totalChargedBytes = 0;
    for (const entry of snapshot.entries) {
      try {
        validateKey(entry.key);
      } catch {
        throw new Error('APP_STORAGE_SNAPSHOT_INVALID');
      }
      if (seenKeys.has(entry.key)) throw new Error('APP_STORAGE_SNAPSHOT_INVALID');
      seenKeys.add(entry.key);
      const serialized = JSON.stringify(entry.value);
      const bytes = Buffer.byteLength(serialized, 'utf8');
      if (
        bytes !== entry.bytes ||
        bytes > MAX_VALUE_BYTES ||
        !Number.isSafeInteger(entry.version) ||
        entry.version < 1 ||
        !Number.isSafeInteger(entry.updatedAt)
      ) {
        throw new Error('APP_STORAGE_SNAPSHOT_INVALID');
      }
      totalBytes += bytes;
      totalChargedBytes += chargedBytes(entry.key, bytes);
      if (totalChargedBytes > MAX_APP_BYTES) throw new Error('APP_STORAGE_SNAPSHOT_INVALID');
      prepared.push({ entry, serialized, bytes });
    }
    if (totalBytes !== snapshot.totalBytes) throw new Error('APP_STORAGE_SNAPSHOT_INVALID');

    await this.db.transaction(async (tx) => {
      await tx.execute('DELETE FROM agent_app_storage WHERE user_id=? AND app_id=?', [scope.userId, scope.appId]);
      for (const { entry, serialized, bytes } of prepared) {
        await tx.execute(
          `INSERT INTO agent_app_storage(user_id,app_id,key,value_json,bytes,version,updated_at)
           VALUES(?,?,?,?,?,?,?)`,
          [scope.userId, scope.appId, entry.key, serialized, bytes, entry.version, entry.updatedAt],
        );
      }
    });
  }

  async clear(scope: Scope): Promise<void> {
    await this.db.execute('DELETE FROM agent_app_storage WHERE user_id=? AND app_id=?', [scope.userId, scope.appId]);
  }
}
