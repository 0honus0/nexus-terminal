import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ArtifactAttachInput,
  ArtifactAttachResult,
  ArtifactBeginMeta,
  ArtifactCleanupPreview,
  ArtifactCleanupResult,
  ArtifactLibraryPage,
  ArtifactLibraryQuery,
  ArtifactLimitPolicyPort,
  ArtifactPort,
  ArtifactReadRange,
  ArtifactRef,
  ArtifactStorageSummary,
  Scope,
  UploadReservation,
} from '../../../modules/agent/ai/artifact.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface LocalArtifactStoreOptions {
  dataDirectory: string;
  uploadTtlSeconds?: number;
}

interface ArtifactRow {
  id: string;
  user_id: number;
  app_id: string;
  original_name: string;
  media_type: string;
  storage_key: string;
  sha256: string | null;
  size_bytes: number;
  reserved_bytes: number;
  status: ArtifactRef['status'];
  retained: number;
  version: number;
  created_at: number;
  ready_at: number | null;
  expires_at: number | null;
  deleted_at: number | null;
}

interface CleanupSelectionItem {
  id: string;
  appId: string;
  version: number;
  sizeBytes: number;
  storageKey: string;
}

const MAX_RANGE_BYTES = 8 * 1024 * 1024;
const MAX_UPLOADS_PER_USER = 2;
const CLEANUP_CONFIRMATION_TTL_SECONDS = 10 * 60;

const publicRef = (row: ArtifactRow): ArtifactRef => ({
  id: row.id,
  appId: row.app_id,
  originalName: row.original_name,
  mediaType: row.media_type,
  sha256: row.sha256,
  sizeBytes: row.size_bytes,
  status: row.status,
  retained: row.retained === 1,
  version: row.version,
  createdAt: row.created_at,
  readyAt: row.ready_at,
  expiresAt: row.expires_at,
  deletedAt: row.deleted_at,
});

const columns = `
  id, user_id, app_id, original_name, media_type, storage_key, sha256,
  size_bytes, reserved_bytes, status, retained, version, created_at, ready_at, expires_at, deleted_at
`;

const quotaKey = (userId: number): string => `artifact:user:${userId}`;

const encodeCursor = (createdAt: number, id: string): string =>
  Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');

const decodeCursor = (value: string): { createdAt: number; id: string } => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (!Number.isSafeInteger(parsed.createdAt) || typeof parsed.id !== 'string' || parsed.id.length === 0) {
      throw new Error('invalid');
    }
    return { createdAt: parsed.createdAt as number, id: parsed.id };
  } catch {
    throw new Error('CURSOR_INVALID');
  }
};

const artifactProtectionReason = async (
  db: RelationalDatabase,
  artifactId: string,
  now: number,
): Promise<string | null> => {
  const linked = await db.queryOne<{ reason: string }>(
    `SELECT CASE WHEN l.role = 'checkpoint' THEN 'checkpoint' ELSE 'active_run' END AS reason
     FROM agent_artifact_links l
     JOIN agent_runs r ON r.id = l.run_id
     WHERE l.artifact_id = ? AND (
       l.role = 'checkpoint' OR
       r.status IN ('created','running','awaiting_approval','awaiting_budget','cancelling')
     )
     LIMIT 1`,
    [artifactId],
  );
  if (linked) return linked.reason;
  const granted = await db.queryOne<{ id: string }>(
    `SELECT id FROM agent_artifact_grants
     WHERE artifact_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
     LIMIT 1`,
    [artifactId, now],
  );
  if (granted) return 'grant';
  const intentGrant = await db.queryOne<{ id: string }>(
    `SELECT id FROM agent_app_intent_artifact_grants
     WHERE artifact_id = ? AND revoked_at IS NULL AND expires_at > ?
     LIMIT 1`,
    [artifactId, now],
  );
  return intentGrant ? 'intent_grant' : null;
};

export class LocalArtifactStore implements ArtifactPort {
  private readonly root: string;
  private readonly tmpRoot: string;
  private readonly objectsRoot: string;
  private readonly uploadTtlSeconds: number;

  constructor(
    private readonly db: RelationalDatabase,
    private readonly limits: ArtifactLimitPolicyPort,
    private readonly options: LocalArtifactStoreOptions,
  ) {
    this.root = path.join(options.dataDirectory, 'agent', 'artifacts');
    this.tmpRoot = path.join(this.root, 'tmp');
    this.objectsRoot = path.join(this.root, 'objects');
    this.uploadTtlSeconds = options.uploadTtlSeconds ?? 120;
  }

  async begin(scope: Scope, meta: ArtifactBeginMeta): Promise<UploadReservation> {
    if (!Number.isSafeInteger(meta.declaredBytes) || meta.declaredBytes < 0) throw new Error('VALIDATION_FAILED');
    const limits = await this.limits.forUser(scope.userId);
    if (meta.declaredBytes > limits.maxSingleArtifactBytes) throw new Error('PAYLOAD_TOO_LARGE');
    await this.ensureRoots();
    await this.ensureFreeSpace(meta.declaredBytes, limits.minFreeDiskBytes);

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + this.uploadTtlSeconds;
    const artifactId = randomUUID();
    const storageKey = randomUUID();

    await this.db.transaction(async (tx) => {
      const active = await tx.queryOne<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ai_artifacts
         WHERE user_id = ? AND status = 'staging' AND expires_at > ?`,
        [scope.userId, now],
      );
      if ((active?.count ?? 0) >= MAX_UPLOADS_PER_USER) throw new Error('ARTIFACT_UPLOAD_BUSY');

      await tx.execute(
        `INSERT OR IGNORE INTO agent_quota_usage (scope_key, limit_bytes, used_bytes, reserved_bytes)
         VALUES (?, ?, 0, 0)`,
        [quotaKey(scope.userId), limits.maxGlobalArtifactBytes],
      );
      const limitChanged = await tx.execute(
        `UPDATE agent_quota_usage SET limit_bytes = ?
         WHERE scope_key = ? AND used_bytes + reserved_bytes <= ?`,
        [limits.maxGlobalArtifactBytes, quotaKey(scope.userId), limits.maxGlobalArtifactBytes],
      );
      if (limitChanged.changes !== 1) throw new Error('ARTIFACT_QUOTA_STATE_INVALID');
      const quota = await tx.queryOne<{ limit_bytes: number; used_bytes: number; reserved_bytes: number }>(
        'SELECT limit_bytes, used_bytes, reserved_bytes FROM agent_quota_usage WHERE scope_key = ?',
        [quotaKey(scope.userId)],
      );
      if (!quota || quota.used_bytes + quota.reserved_bytes + meta.declaredBytes > quota.limit_bytes) {
        throw new Error('ARTIFACT_QUOTA_EXCEEDED');
      }

      await tx.execute('UPDATE agent_quota_usage SET reserved_bytes = reserved_bytes + ? WHERE scope_key = ?', [
        meta.declaredBytes,
        quotaKey(scope.userId),
      ]);
      await tx.execute(
        `INSERT INTO ai_artifacts (
          id, user_id, app_id, original_name, media_type, storage_key, sha256,
          size_bytes, reserved_bytes, status, retained, version, created_at, ready_at, expires_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, 'staging', 0, 1, ?, NULL, ?, NULL)`,
        [
          artifactId,
          scope.userId,
          scope.appId,
          meta.name,
          meta.mediaType,
          storageKey,
          meta.declaredBytes,
          now,
          expiresAt,
        ],
      );
    });

    return { artifactId, declaredBytes: meta.declaredBytes, expiresAt };
  }

  async get(scope: Scope, artifactId: string): Promise<ArtifactRef | null> {
    const row = await this.getRow(scope, artifactId);
    return row ? publicRef(row) : null;
  }

  async write(
    scope: Scope,
    artifactId: string,
    source: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<ArtifactRef> {
    await this.ensureRoots();
    const writeLimits = await this.limits.forUser(scope.userId);
    const row = await this.getRow(scope, artifactId);
    if (!row) throw new Error('NOT_FOUND');
    if (row.status !== 'staging') throw new Error('STATE_CONFLICT');
    if (row.expires_at !== null && row.expires_at <= Math.floor(Date.now() / 1000)) {
      await this.releaseStaging(row);
      throw new Error('ARTIFACT_UPLOAD_EXPIRED');
    }

    const tmpPath = path.join(this.tmpRoot, `${row.storage_key}.part`);
    const objectDirectory = path.join(this.objectsRoot, row.storage_key.slice(0, 2));
    const objectPath = path.join(objectDirectory, row.storage_key);
    let file: Awaited<ReturnType<typeof fs.open>> | null = null;
    let renamed = false;
    let written = 0;
    let freeSpaceCheckpoint = 0;
    const hash = createHash('sha256');

    try {
      file = await fs.open(tmpPath, 'wx', 0o600);
      for await (const rawChunk of source) {
        if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
        const chunk = Buffer.from(rawChunk);
        if (written + chunk.length > row.reserved_bytes) throw new Error('PAYLOAD_TOO_LARGE');
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const result = await file.write(chunk, offset, chunk.length - offset, null);
          if (result.bytesWritten <= 0) throw new Error('ARTIFACT_WRITE_FAILED');
          offset += result.bytesWritten;
        }
        written += chunk.length;
        if (written - freeSpaceCheckpoint >= 1024 * 1024) {
          await this.ensureFreeSpace(0, writeLimits.minFreeDiskBytes);
          freeSpaceCheckpoint = written;
        }
      }
      if (written !== row.reserved_bytes) throw new Error('ARTIFACT_SIZE_MISMATCH');
      await file.sync();
      await file.close();
      file = null;

      await fs.mkdir(objectDirectory, { recursive: true, mode: 0o700 });
      await fs.rename(tmpPath, objectPath);
      renamed = true;
      const directoryHandle = await fs.open(objectDirectory, 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }

      const sha256 = hash.digest('hex');
      const readyAt = Math.floor(Date.now() / 1000);
      await this.db.transaction(async (tx) => {
        const changed = await tx.execute(
          `UPDATE ai_artifacts SET
             sha256 = ?, size_bytes = ?, reserved_bytes = 0, status = 'ready',
             ready_at = ?, expires_at = NULL, version = version + 1
           WHERE id = ? AND user_id = ? AND app_id = ? AND status = 'staging' AND version = ?`,
          [sha256, written, readyAt, row.id, row.user_id, row.app_id, row.version],
        );
        if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
        const quotaChanged = await tx.execute(
          `UPDATE agent_quota_usage SET
             reserved_bytes = reserved_bytes - ?, used_bytes = used_bytes + ?
           WHERE scope_key = ? AND reserved_bytes >= ?`,
          [row.reserved_bytes, written, quotaKey(row.user_id), row.reserved_bytes],
        );
        if (quotaChanged.changes !== 1) throw new Error('ARTIFACT_QUOTA_STATE_INVALID');
      });

      const ready = await this.get(scope, artifactId);
      if (!ready) throw new Error('NOT_FOUND');
      return ready;
    } catch (error) {
      if (file) await file.close().catch(() => undefined);
      if (!renamed) {
        await fs.rm(tmpPath, { force: true }).catch(() => undefined);
        await this.releaseStaging(row).catch(() => undefined);
      }
      throw error;
    }
  }

  async *read(scope: Scope, artifactId: string, range: ArtifactReadRange): AsyncIterable<Uint8Array> {
    const row = await this.getRow(scope, artifactId);
    if (!row) throw new Error('NOT_FOUND');
    if (row.status === 'unavailable') throw new Error('ARTIFACT_UNAVAILABLE');
    if (row.status !== 'ready') throw new Error('STATE_CONFLICT');
    const length = range.endInclusive - range.start + 1;
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.endInclusive) ||
      range.start < 0 ||
      range.endInclusive < range.start ||
      range.endInclusive >= row.size_bytes ||
      length > MAX_RANGE_BYTES
    ) {
      throw new Error('ARTIFACT_RANGE_INVALID');
    }

    const objectPath = this.objectPath(row.storage_key);
    try {
      const info = await fs.lstat(objectPath);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('ARTIFACT_UNAVAILABLE');
    } catch (error) {
      await this.markUnavailable(row).catch(() => undefined);
      if (error instanceof Error && error.message === 'ARTIFACT_UNAVAILABLE') throw error;
      throw new Error('ARTIFACT_UNAVAILABLE');
    }

    const stream = createReadStream(objectPath, { start: range.start, end: range.endInclusive });
    for await (const chunk of stream) yield Buffer.from(chunk);
  }

  async retain(scope: Scope, artifactId: string, retained: boolean, expectedVersion: number): Promise<ArtifactRef> {
    const result = await this.db.execute(
      `UPDATE ai_artifacts SET retained = ?, version = version + 1
       WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status IN ('ready','unavailable')`,
      [retained ? 1 : 0, artifactId, scope.userId, scope.appId, expectedVersion],
    );
    if (result.changes !== 1) {
      if (await this.get(scope, artifactId)) throw new Error('STATE_CONFLICT');
      throw new Error('NOT_FOUND');
    }
    const updated = await this.get(scope, artifactId);
    if (!updated) throw new Error('NOT_FOUND');
    return updated;
  }

  async delete(scope: Scope, artifactId: string, expectedVersion: number): Promise<void> {
    const row = await this.getRow(scope, artifactId);
    if (!row) throw new Error('NOT_FOUND');
    if (row.version !== expectedVersion) throw new Error('STATE_CONFLICT');
    const now = Math.floor(Date.now() / 1000);

    if (row.status === 'staging') {
      await this.releaseStaging(row);
      await fs.rm(path.join(this.tmpRoot, `${row.storage_key}.part`), { force: true }).catch(() => undefined);
      return;
    }
    if (row.status === 'deleted') return;
    if (row.retained === 1) throw new Error('ARTIFACT_PROTECTED');
    if (await artifactProtectionReason(this.db, row.id, now)) throw new Error('ARTIFACT_PROTECTED');

    const marked = await this.db.execute(
      `UPDATE ai_artifacts SET status = 'deleting', version = version + 1
       WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status IN ('ready','unavailable')`,
      [artifactId, scope.userId, scope.appId, expectedVersion],
    );
    if (marked.changes !== 1) throw new Error('STATE_CONFLICT');

    if (row.status === 'ready') await fs.rm(this.objectPath(row.storage_key), { force: true });
    await this.db.transaction(async (tx) => {
      const deleted = await tx.execute(
        `UPDATE ai_artifacts SET status = 'deleted', deleted_at = ?, retained = 0, version = version + 1
         WHERE id = ? AND user_id = ? AND app_id = ? AND status = 'deleting'`,
        [now, artifactId, scope.userId, scope.appId],
      );
      if (deleted.changes !== 1) throw new Error('STATE_CONFLICT');
      if (row.size_bytes > 0) {
        const quotaChanged = await tx.execute(
          `UPDATE agent_quota_usage SET used_bytes = used_bytes - ?
           WHERE scope_key = ? AND used_bytes >= ?`,
          [row.size_bytes, quotaKey(scope.userId), row.size_bytes],
        );
        if (quotaChanged.changes !== 1) throw new Error('ARTIFACT_QUOTA_STATE_INVALID');
      }
    });
  }

  async listLibrary(userId: number, query: ArtifactLibraryQuery): Promise<ArtifactLibraryPage> {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100)
      throw new Error('VALIDATION_FAILED');
    const clauses = ['user_id = ?', "status <> 'deleted'"];
    const parameters: unknown[] = [userId];
    if (query.appId) {
      clauses.push('app_id = ?');
      parameters.push(query.appId);
    }
    if (query.retained !== undefined) {
      clauses.push('retained = ?');
      parameters.push(query.retained ? 1 : 0);
    }
    if (query.q) {
      clauses.push('(LOWER(original_name) LIKE ? OR LOWER(media_type) LIKE ?)');
      const needle = `%${query.q.toLowerCase().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
      parameters.push(needle, needle);
    }
    if (query.before) {
      const cursor = decodeCursor(query.before);
      clauses.push('(created_at < ? OR (created_at = ? AND id < ?))');
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    parameters.push(query.limit + 1);
    const rows = await this.db.queryAll<ArtifactRow>(
      `SELECT ${columns} FROM ai_artifacts
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      parameters,
    );
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(publicRef),
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  async storageSummary(userId: number): Promise<ArtifactStorageSummary> {
    const now = Math.floor(Date.now() / 1000);
    const limits = await this.limits.forUser(userId);
    const sums = await this.db.queryOne<{
      total_bytes: number;
      retained_bytes: number;
      protected_bytes: number;
      reclaimable_bytes: number;
      staging_bytes: number;
      unavailable_bytes: number;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN a.status IN ('ready','deleting') THEN a.size_bytes ELSE 0 END), 0) AS total_bytes,
         COALESCE(SUM(CASE WHEN a.status = 'ready' AND a.retained = 1 THEN a.size_bytes ELSE 0 END), 0) AS retained_bytes,
         COALESCE(SUM(CASE WHEN a.status = 'ready' AND a.retained = 0 AND (
           EXISTS (
             SELECT 1 FROM agent_artifact_links l JOIN agent_runs r ON r.id = l.run_id
             WHERE l.artifact_id = a.id AND (
               l.role = 'checkpoint' OR
               r.status IN ('created','running','awaiting_approval','awaiting_budget','cancelling')
             )
           ) OR EXISTS (
             SELECT 1 FROM agent_artifact_grants g
             WHERE g.artifact_id = a.id AND g.revoked_at IS NULL
               AND (g.expires_at IS NULL OR g.expires_at > ?)
           ) OR EXISTS (
             SELECT 1 FROM agent_app_intent_artifact_grants ig
             WHERE ig.artifact_id = a.id AND ig.revoked_at IS NULL AND ig.expires_at > ?
           )
         ) THEN a.size_bytes ELSE 0 END), 0) AS protected_bytes,
         COALESCE(SUM(CASE WHEN a.status = 'ready' AND a.retained = 0 AND NOT (
           EXISTS (
             SELECT 1 FROM agent_artifact_links l JOIN agent_runs r ON r.id = l.run_id
             WHERE l.artifact_id = a.id AND (
               l.role = 'checkpoint' OR
               r.status IN ('created','running','awaiting_approval','awaiting_budget','cancelling')
             )
           ) OR EXISTS (
             SELECT 1 FROM agent_artifact_grants g
             WHERE g.artifact_id = a.id AND g.revoked_at IS NULL
               AND (g.expires_at IS NULL OR g.expires_at > ?)
           ) OR EXISTS (
             SELECT 1 FROM agent_app_intent_artifact_grants ig
             WHERE ig.artifact_id = a.id AND ig.revoked_at IS NULL AND ig.expires_at > ?
           )
         ) THEN a.size_bytes ELSE 0 END), 0) AS reclaimable_bytes,
         COALESCE(SUM(CASE WHEN a.status = 'staging' THEN a.reserved_bytes ELSE 0 END), 0) AS staging_bytes,
         COALESCE(SUM(CASE WHEN a.status = 'unavailable' THEN a.size_bytes ELSE 0 END), 0) AS unavailable_bytes
       FROM ai_artifacts a WHERE a.user_id = ? AND a.status <> 'deleted'`,
      [now, now, now, now, userId],
    );
    const quota = await this.db.queryOne<{ limit_bytes: number; reserved_bytes: number }>(
      'SELECT limit_bytes, reserved_bytes FROM agent_quota_usage WHERE scope_key = ?',
      [quotaKey(userId)],
    );
    return {
      totalBytes: sums?.total_bytes ?? 0,
      retainedBytes: sums?.retained_bytes ?? 0,
      protectedBytes: sums?.protected_bytes ?? 0,
      reclaimableBytes: sums?.reclaimable_bytes ?? 0,
      stagingBytes: sums?.staging_bytes ?? 0,
      unavailableBytes: sums?.unavailable_bytes ?? 0,
      reservedBytes: quota?.reserved_bytes ?? 0,
      limitBytes: limits.maxGlobalArtifactBytes,
    };
  }

  async cleanupPreview(userId: number): Promise<ArtifactCleanupPreview> {
    const now = Math.floor(Date.now() / 1000);
    const rows = await this.db.queryAll<ArtifactRow>(
      `SELECT ${columns} FROM ai_artifacts a
       WHERE a.user_id = ? AND a.status = 'ready' AND a.retained = 0
         AND NOT EXISTS (
           SELECT 1 FROM agent_artifact_links l
           JOIN agent_runs r ON r.id = l.run_id
           WHERE l.artifact_id = a.id AND (
             l.role = 'checkpoint' OR
             r.status IN ('created','running','awaiting_approval','awaiting_budget','cancelling')
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM agent_artifact_grants g
           WHERE g.artifact_id = a.id AND g.revoked_at IS NULL
             AND (g.expires_at IS NULL OR g.expires_at > ?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM agent_app_intent_artifact_grants ig
           WHERE ig.artifact_id = a.id AND ig.revoked_at IS NULL AND ig.expires_at > ?
         )
       ORDER BY a.created_at, a.id`,
      [userId, now, now],
    );
    const totalReady = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ai_artifacts WHERE user_id = ? AND status = 'ready'`,
      [userId],
    );
    const selection: CleanupSelectionItem[] = rows.map((row) => ({
      id: row.id,
      appId: row.app_id,
      version: row.version,
      sizeBytes: row.size_bytes,
      storageKey: row.storage_key,
    }));
    const byApp = new Map<string, { count: number; bytes: number }>();
    for (const item of selection) {
      const current = byApp.get(item.appId) ?? { count: 0, bytes: 0 };
      current.count += 1;
      current.bytes += item.sizeBytes;
      byApp.set(item.appId, current);
    }
    const confirmationId = randomUUID();
    const expiresAt = now + CLEANUP_CONFIRMATION_TTL_SECONDS;
    await this.db.transaction(async (tx) => {
      await tx.execute('DELETE FROM agent_artifact_cleanup_confirmations WHERE expires_at <= ?', [now]);
      await tx.execute(
        `INSERT INTO agent_artifact_cleanup_confirmations (id, user_id, selection_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [confirmationId, userId, JSON.stringify(selection), now, expiresAt],
      );
    });
    return {
      confirmationId,
      expiresAt,
      selectedCount: selection.length,
      selectedBytes: selection.reduce((total, item) => total + item.sizeBytes, 0),
      protectedCount: Math.max(0, (totalReady?.count ?? 0) - selection.length),
      byApp: [...byApp.entries()].map(([appId, summary]) => ({ appId, ...summary })),
    };
  }

  async cleanupConfirm(userId: number, confirmationId: string): Promise<ArtifactCleanupResult> {
    const now = Math.floor(Date.now() / 1000);
    const marked: ArtifactRow[] = [];
    let skippedCount = 0;
    await this.db.transaction(async (tx) => {
      const confirmation = await tx.queryOne<{ selection_json: string; expires_at: number }>(
        `SELECT selection_json, expires_at FROM agent_artifact_cleanup_confirmations
         WHERE id = ? AND user_id = ?`,
        [confirmationId, userId],
      );
      if (!confirmation) throw new Error('CLEANUP_CONFIRMATION_NOT_FOUND');
      if (confirmation.expires_at <= now) {
        await tx.execute('DELETE FROM agent_artifact_cleanup_confirmations WHERE id = ? AND user_id = ?', [
          confirmationId,
          userId,
        ]);
        throw new Error('CLEANUP_CONFIRMATION_EXPIRED');
      }
      const selection = JSON.parse(confirmation.selection_json) as CleanupSelectionItem[];
      for (const item of selection) {
        const row = await tx.queryOne<ArtifactRow>(`SELECT ${columns} FROM ai_artifacts WHERE id = ? AND user_id = ?`, [
          item.id,
          userId,
        ]);
        if (
          !row ||
          row.app_id !== item.appId ||
          row.storage_key !== item.storageKey ||
          row.size_bytes !== item.sizeBytes ||
          row.version !== item.version ||
          row.status !== 'ready' ||
          row.retained === 1 ||
          (await artifactProtectionReason(tx, row.id, now))
        ) {
          skippedCount += 1;
          continue;
        }
        const changed = await tx.execute(
          `UPDATE ai_artifacts SET status = 'deleting', version = version + 1
           WHERE id = ? AND user_id = ? AND version = ? AND status = 'ready' AND retained = 0`,
          [row.id, userId, row.version],
        );
        if (changed.changes !== 1) {
          skippedCount += 1;
          continue;
        }
        marked.push(row);
      }
      await tx.execute('DELETE FROM agent_artifact_cleanup_confirmations WHERE id = ? AND user_id = ?', [
        confirmationId,
        userId,
      ]);
    });

    let deletedCount = 0;
    let deletedBytes = 0;
    let failedCount = 0;
    for (const row of marked) {
      try {
        await fs.rm(this.objectPath(row.storage_key), { force: true });
        await this.db.transaction(async (tx) => {
          const deleted = await tx.execute(
            `UPDATE ai_artifacts SET status = 'deleted', retained = 0, deleted_at = ?, version = version + 1
             WHERE id = ? AND user_id = ? AND status = 'deleting'`,
            [now, row.id, userId],
          );
          if (deleted.changes !== 1) throw new Error('STATE_CONFLICT');
          if (row.size_bytes > 0) {
            const quotaChanged = await tx.execute(
              `UPDATE agent_quota_usage SET used_bytes = used_bytes - ?
               WHERE scope_key = ? AND used_bytes >= ?`,
              [row.size_bytes, quotaKey(userId), row.size_bytes],
            );
            if (quotaChanged.changes !== 1) throw new Error('ARTIFACT_QUOTA_STATE_INVALID');
          }
        });
        deletedCount += 1;
        deletedBytes += row.size_bytes;
      } catch {
        failedCount += 1;
      }
    }
    return {
      deletedCount,
      deletedBytes,
      skippedCount,
      failedCount,
      partial: skippedCount > 0 || failedCount > 0,
    };
  }

  async attach(userId: number, artifactId: string, input: ArtifactAttachInput): Promise<ArtifactAttachResult> {
    const now = Math.floor(Date.now() / 1000);
    return this.db.transaction(async (tx) => {
      const artifact = await tx.queryOne<ArtifactRow>(
        `SELECT ${columns} FROM ai_artifacts WHERE id = ? AND user_id = ? AND status = 'ready'`,
        [artifactId, userId],
      );
      if (!artifact) throw new Error('ARTIFACT_UNAVAILABLE');
      if (input.expectedVersion !== undefined && artifact.version !== input.expectedVersion) {
        throw new Error('STATE_CONFLICT');
      }
      const app = await tx.queryOne<{ desired_state: string; observed_state: string }>(
        `SELECT desired_state, observed_state FROM agent_apps WHERE user_id = ? AND app_id = ?`,
        [userId, input.targetAppId],
      );
      if (!app) throw new Error('NOT_FOUND');
      if (app.desired_state !== 'enabled' || !['running', 'degraded'].includes(app.observed_state)) {
        throw new Error('AGENT_APP_DISABLED');
      }
      const thread = await tx.queryOne<{ id: string }>(
        `SELECT id FROM ai_threads WHERE id = ? AND user_id = ? AND app_id = ?`,
        [input.threadId, userId, input.targetAppId],
      );
      if (!thread) throw new Error('NOT_FOUND');
      if (input.runId) {
        const run = await tx.queryOne<{ status: string }>(
          `SELECT status FROM agent_runs
           WHERE id = ? AND thread_id = ? AND user_id = ? AND app_id = ?`,
          [input.runId, input.threadId, userId, input.targetAppId],
        );
        if (!run) throw new Error('NOT_FOUND');
        if (!['created', 'running', 'awaiting_approval', 'awaiting_budget'].includes(run.status)) {
          throw new Error('RUN_NOT_ACCEPTING_INPUT');
        }
      }

      const crossApp = artifact.app_id !== input.targetAppId;
      if (crossApp) {
        const scopeKey = input.runId ? `run:${input.runId}` : `thread:${input.threadId}`;
        await tx.execute(
          `INSERT OR IGNORE INTO agent_artifact_grants
            (id, artifact_id, receiver_user_id, receiver_app_id, receiver_thread_id, receiver_run_id,
             scope_key, role, expires_at, revoked_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'input', NULL, NULL, ?)`,
          [randomUUID(), artifact.id, userId, input.targetAppId, input.threadId, input.runId ?? null, scopeKey, now],
        );
      }
      if (input.runId) {
        await tx.execute(
          `INSERT OR IGNORE INTO agent_artifact_links (artifact_id, run_id, role, created_at)
           VALUES (?, ?, 'input', ?)`,
          [artifact.id, input.runId, now],
        );
      }
      return {
        artifact: publicRef(artifact),
        sourceAppId: artifact.app_id,
        targetAppId: input.targetAppId,
        threadId: input.threadId,
        runId: input.runId ?? null,
        role: 'input',
        crossApp,
      };
    });
  }

  private async getRow(scope: Scope, artifactId: string): Promise<ArtifactRow | null> {
    return this.db.queryOne<ArtifactRow>(
      `SELECT ${columns} FROM ai_artifacts
       WHERE id = ? AND user_id = ? AND app_id = ? AND status <> 'deleted'`,
      [artifactId, scope.userId, scope.appId],
    );
  }

  private async releaseStaging(row: ArtifactRow): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db.transaction(async (tx) => {
      const changed = await tx.execute(
        `UPDATE ai_artifacts SET reserved_bytes = 0, status = 'deleted', deleted_at = ?, version = version + 1
         WHERE id = ? AND user_id = ? AND app_id = ? AND status = 'staging'`,
        [now, row.id, row.user_id, row.app_id],
      );
      if (changed.changes !== 1) return;
      const quotaChanged = await tx.execute(
        `UPDATE agent_quota_usage SET reserved_bytes = reserved_bytes - ?
         WHERE scope_key = ? AND reserved_bytes >= ?`,
        [row.reserved_bytes, quotaKey(row.user_id), row.reserved_bytes],
      );
      if (quotaChanged.changes !== 1) throw new Error('ARTIFACT_QUOTA_STATE_INVALID');
    });
  }

  private async markUnavailable(row: ArtifactRow): Promise<void> {
    if (row.status !== 'ready') return;
    await this.db.execute(
      `UPDATE ai_artifacts SET status = 'unavailable', version = version + 1
       WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status = 'ready'`,
      [row.id, row.user_id, row.app_id, row.version],
    );
  }

  private objectPath(storageKey: string): string {
    return path.join(this.objectsRoot, storageKey.slice(0, 2), storageKey);
  }

  private async ensureRoots(): Promise<void> {
    await fs.mkdir(this.tmpRoot, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.objectsRoot, { recursive: true, mode: 0o700 });
  }

  private async ensureFreeSpace(incomingBytes: number, minFreeDiskBytes: number): Promise<void> {
    const stats = await fs.statfs(this.root);
    const available = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isSafeInteger(available) || available - incomingBytes < minFreeDiskBytes) {
      throw new Error('ARTIFACT_QUOTA_EXCEEDED');
    }
  }
}
