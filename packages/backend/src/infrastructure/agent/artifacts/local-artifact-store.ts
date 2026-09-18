import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ArtifactAgentAccess,
  ArtifactAttachInput,
  ArtifactAttachResult,
  ArtifactBeginMeta,
  ArtifactCleanupPreview,
  ArtifactCleanupResult,
  ArtifactLibraryPage,
  ArtifactLibraryQuery,
  ArtifactLimitPolicyPort,
  ArtifactMaintenancePort,
  ArtifactPort,
  ArtifactReadRange,
  ArtifactRef,
  ArtifactStorageSummary,
  Scope,
  UploadReservation,
} from '../../../modules/agent/ai/artifact.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import {
  durableInteger,
  durableRecord,
  durableString,
  parseDurableJson,
} from '../runtime/durable-state-decoders';

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

const retentionDeadline = (readyAt: number, ttlSeconds: number): number =>
  ttlSeconds > Number.MAX_SAFE_INTEGER - readyAt ? Number.MAX_SAFE_INTEGER : readyAt + ttlSeconds;

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

const qualifiedArtifactColumns = `
  a.id, a.user_id, a.app_id, a.original_name, a.media_type, a.storage_key, a.sha256,
  a.size_bytes, a.reserved_bytes, a.status, a.retained, a.version, a.created_at, a.ready_at, a.expires_at, a.deleted_at
`;

const imageArtifactPredicate = `(LOWER(media_type) LIKE 'image/%')`;
const mediaArtifactPredicate = `(LOWER(media_type) LIKE 'audio/%' OR LOWER(media_type) LIKE 'video/%')`;
const archiveArtifactPredicate = `(
  LOWER(media_type) IN (
    'application/zip','application/x-7z-compressed','application/vnd.rar','application/x-rar-compressed',
    'application/x-tar','application/gzip','application/x-gzip','application/x-bzip2','application/x-xz'
  ) OR LOWER(original_name) GLOB '*.zip' OR LOWER(original_name) GLOB '*.7z' OR LOWER(original_name) GLOB '*.rar'
    OR LOWER(original_name) GLOB '*.tar' OR LOWER(original_name) GLOB '*.tgz' OR LOWER(original_name) GLOB '*.tar.gz'
    OR LOWER(original_name) GLOB '*.gz' OR LOWER(original_name) GLOB '*.bz2' OR LOWER(original_name) GLOB '*.xz'
)`;
const codeArtifactPredicate = `(
  LOWER(media_type) IN (
    'application/json','application/ld+json','application/xml','text/xml','text/html','text/css',
    'text/javascript','application/javascript','application/sql','application/x-yaml','text/yaml',
    'text/x-python','text/x-shellscript'
  ) OR LOWER(original_name) GLOB '*.js' OR LOWER(original_name) GLOB '*.jsx' OR LOWER(original_name) GLOB '*.ts'
    OR LOWER(original_name) GLOB '*.tsx' OR LOWER(original_name) GLOB '*.vue' OR LOWER(original_name) GLOB '*.py'
    OR LOWER(original_name) GLOB '*.go' OR LOWER(original_name) GLOB '*.rs' OR LOWER(original_name) GLOB '*.java'
    OR LOWER(original_name) GLOB '*.c' OR LOWER(original_name) GLOB '*.h' OR LOWER(original_name) GLOB '*.cpp'
    OR LOWER(original_name) GLOB '*.hpp' OR LOWER(original_name) GLOB '*.cs' OR LOWER(original_name) GLOB '*.rb'
    OR LOWER(original_name) GLOB '*.php' OR LOWER(original_name) GLOB '*.sh' OR LOWER(original_name) GLOB '*.sql'
    OR LOWER(original_name) GLOB '*.html' OR LOWER(original_name) GLOB '*.css' OR LOWER(original_name) GLOB '*.scss'
    OR LOWER(original_name) GLOB '*.less' OR LOWER(original_name) GLOB '*.json' OR LOWER(original_name) GLOB '*.jsonl'
    OR LOWER(original_name) GLOB '*.yaml' OR LOWER(original_name) GLOB '*.yml' OR LOWER(original_name) GLOB '*.toml'
    OR LOWER(original_name) GLOB '*.xml'
)`;
const documentArtifactPredicate = `(
  LOWER(media_type) IN (
    'application/pdf','application/rtf','text/rtf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet','application/epub+zip','text/csv','text/markdown'
  ) OR LOWER(original_name) GLOB '*.pdf' OR LOWER(original_name) GLOB '*.doc' OR LOWER(original_name) GLOB '*.docx'
    OR LOWER(original_name) GLOB '*.ppt' OR LOWER(original_name) GLOB '*.pptx' OR LOWER(original_name) GLOB '*.xls'
    OR LOWER(original_name) GLOB '*.xlsx' OR LOWER(original_name) GLOB '*.csv' OR LOWER(original_name) GLOB '*.txt'
    OR LOWER(original_name) GLOB '*.md' OR LOWER(original_name) GLOB '*.rtf' OR LOWER(original_name) GLOB '*.odt'
    OR LOWER(original_name) GLOB '*.ods' OR LOWER(original_name) GLOB '*.epub'
)`;
const knownArtifactKindPredicate = `(
  ${imageArtifactPredicate} OR ${documentArtifactPredicate} OR ${codeArtifactPredicate} OR ${archiveArtifactPredicate} OR ${mediaArtifactPredicate}
)`;

const artifactKindPredicate = (kind: NonNullable<ArtifactLibraryQuery['kind']>): string => {
  if (kind === 'image') return imageArtifactPredicate;
  if (kind === 'document') return documentArtifactPredicate;
  if (kind === 'code') return codeArtifactPredicate;
  if (kind === 'archive') return archiveArtifactPredicate;
  if (kind === 'media') return mediaArtifactPredicate;
  return `(NOT ${knownArtifactKindPredicate})`;
};

const quotaKey = (userId: number): string => `artifact:user:${userId}`;

const encodeCursor = (createdAt: number, id: string): string =>
  Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');

const decodeCursor = (value: string): { createdAt: number; id: string } => {
  try {
    const parsed = durableRecord(parseDurableJson(Buffer.from(value, 'base64url').toString('utf8')));
    const id = durableString(parsed.id) as string;
    if (!id) throw new Error('invalid');
    return { createdAt: durableInteger(parsed.createdAt), id };
  } catch {
    throw new Error('CURSOR_INVALID');
  }
};

const decodeCleanupSelection = (raw: string): CleanupSelectionItem[] => {
  const value = parseDurableJson(raw);
  if (!Array.isArray(value) || value.length > 10_000) throw new Error('CLEANUP_CONFIRMATION_INVALID');
  return value.map((item) => {
    const record = durableRecord(item);
    return {
      id: durableString(record.id) as string,
      appId: durableString(record.appId) as string,
      version: durableInteger(record.version, 1),
      sizeBytes: durableInteger(record.sizeBytes),
      storageKey: durableString(record.storageKey) as string,
    };
  });
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
       r.status IN ('created','running','awaiting_approval','awaiting_budget','awaiting_input','cancelling')
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

export class LocalArtifactStore implements ArtifactPort, ArtifactMaintenancePort {
  private readonly root: string;
  private readonly tmpRoot: string;
  private readonly objectsRoot: string;
  private readonly uploadTtlSeconds: number;
  private readonly activeWrites = new Set<string>();

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

  async getForAgent(scope: Scope, access: ArtifactAgentAccess, artifactId: string): Promise<ArtifactRef | null> {
    const row = await this.getAgentRow(scope, access, artifactId);
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
    if (this.activeWrites.has(row.id)) throw new Error('ARTIFACT_UPLOAD_BUSY');
    this.activeWrites.add(row.id);

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
      if (
        !(await this.finalizeReady(
          row,
          sha256,
          written,
          readyAt,
          retentionDeadline(readyAt, writeLimits.unretainedArtifactTtlSeconds),
        ))
      ) {
        throw new Error('STATE_CONFLICT');
      }

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
    } finally {
      this.activeWrites.delete(row.id);
    }
  }

  async *read(scope: Scope, artifactId: string, range: ArtifactReadRange): AsyncIterable<Uint8Array> {
    const row = await this.getRow(scope, artifactId);
    if (!row) throw new Error('NOT_FOUND');
    yield* this.readRow(row, range);
  }

  async *readForAgent(
    scope: Scope,
    access: ArtifactAgentAccess,
    artifactId: string,
    range: ArtifactReadRange,
  ): AsyncIterable<Uint8Array> {
    const row = await this.getAgentRow(scope, access, artifactId);
    if (!row) throw new Error('ARTIFACT_NOT_AUTHORIZED_FOR_RUN');
    yield* this.readRow(row, range);
  }

  private async *readRow(row: ArtifactRow, range: ArtifactReadRange): AsyncIterable<Uint8Array> {
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
    const expiresAt = retained
      ? null
      : retentionDeadline(
          Math.floor(Date.now() / 1000),
          (await this.limits.forUser(scope.userId)).unretainedArtifactTtlSeconds,
        );
    const result = await this.db.execute(
      `UPDATE ai_artifacts SET retained = ?, expires_at = ?, version = version + 1
       WHERE id = ? AND user_id = ? AND app_id = ? AND version = ? AND status IN ('ready','unavailable')`,
      [retained ? 1 : 0, expiresAt, artifactId, scope.userId, scope.appId, expectedVersion],
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

    if (!(await this.finalizeDeleting({ ...row, status: 'deleting', version: row.version + 1 }, now))) {
      throw new Error('STATE_CONFLICT');
    }
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
    if (query.kind) clauses.push(artifactKindPredicate(query.kind));
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
               r.status IN ('created','running','awaiting_approval','awaiting_budget','awaiting_input','cancelling')
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
               r.status IN ('created','running','awaiting_approval','awaiting_budget','awaiting_input','cancelling')
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
             r.status IN ('created','running','awaiting_approval','awaiting_budget','awaiting_input','cancelling')
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
      const selection = decodeCleanupSelection(confirmation.selection_json);
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
        if (!(await this.finalizeDeleting({ ...row, status: 'deleting', version: row.version + 1 }, now))) {
          throw new Error('STATE_CONFLICT');
        }
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
        if (!['created', 'running', 'awaiting_approval', 'awaiting_budget', 'awaiting_input'].includes(run.status)) {
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

  async reconcile(limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('VALIDATION_FAILED');
    await this.ensureRoots();
    const now = Math.floor(Date.now() / 1000);
    const rows = await this.db.queryAll<ArtifactRow>(
      `SELECT ${columns} FROM ai_artifacts
       WHERE status IN ('staging','deleting')
       ORDER BY CASE WHEN status = 'deleting' THEN 0 ELSE 1 END,
                COALESCE(expires_at, created_at), id
       LIMIT ?`,
      [limit],
    );
    let repaired = 0;
    for (const row of rows) {
      try {
        if (row.status === 'deleting') {
          if (await this.finalizeDeleting(row, now)) repaired += 1;
          continue;
        }
        if (this.activeWrites.has(row.id)) continue;
        if (await this.reconcileStaging(row, now)) repaired += 1;
      } catch {
        // Leave the durable non-terminal row intact. The next bounded sweep retries the same
        // transition instead of guessing whether a filesystem operation completed.
      }
    }
    return repaired;
  }

  async sweepExpired(limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('VALIDATION_FAILED');
    const now = Math.floor(Date.now() / 1000);
    const rows = await this.db.queryAll<ArtifactRow>(
      `SELECT ${columns} FROM ai_artifacts
       WHERE status IN ('ready','unavailable') AND retained = 0
         AND (expires_at IS NULL OR expires_at <= ?)
       ORDER BY COALESCE(expires_at, ready_at, created_at), id
       LIMIT ?`,
      [now, limit],
    );
    const policies = new Map<number, Awaited<ReturnType<ArtifactLimitPolicyPort['forUser']>>>();
    let deleted = 0;
    for (const row of rows) {
      try {
        let candidate = row;
        if (candidate.expires_at === null) {
          let policy = policies.get(candidate.user_id);
          if (!policy) {
            policy = await this.limits.forUser(candidate.user_id);
            policies.set(candidate.user_id, policy);
          }
          const expiresAt = retentionDeadline(
            candidate.ready_at ?? candidate.created_at,
            policy.unretainedArtifactTtlSeconds,
          );
          const updated = await this.db.execute(
            `UPDATE ai_artifacts SET expires_at = ?, version = version + 1
             WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?
               AND status IN ('ready','unavailable') AND retained = 0 AND expires_at IS NULL`,
            [expiresAt, candidate.id, candidate.user_id, candidate.app_id, candidate.version],
          );
          if (updated.changes !== 1) continue;
          candidate = { ...candidate, expires_at: expiresAt, version: candidate.version + 1 };
        }
        if (candidate.expires_at === null || candidate.expires_at > now) continue;
        if (await artifactProtectionReason(this.db, candidate.id, now)) continue;
        const marked = await this.db.execute(
          `UPDATE ai_artifacts SET status = 'deleting', version = version + 1
           WHERE id = ? AND user_id = ? AND app_id = ? AND version = ?
             AND status IN ('ready','unavailable') AND retained = 0 AND expires_at <= ?`,
          [candidate.id, candidate.user_id, candidate.app_id, candidate.version, now],
        );
        if (marked.changes !== 1) continue;
        if (await this.finalizeDeleting({ ...candidate, status: 'deleting', version: candidate.version + 1 }, now)) {
          deleted += 1;
        }
      } catch {
        // The next bounded maintenance pass retries any durable non-terminal state.
      }
    }
    return deleted;
  }

  private async getRow(scope: Scope, artifactId: string): Promise<ArtifactRow | null> {
    return this.db.queryOne<ArtifactRow>(
      `SELECT ${columns} FROM ai_artifacts
       WHERE id = ? AND user_id = ? AND app_id = ? AND status <> 'deleted'`,
      [artifactId, scope.userId, scope.appId],
    );
  }

  private async getAgentRow(
    scope: Scope,
    access: ArtifactAgentAccess,
    artifactId: string,
  ): Promise<ArtifactRow | null> {
    const now = Math.floor(Date.now() / 1000);
    return this.db.queryOne<ArtifactRow>(
      `SELECT ${qualifiedArtifactColumns} FROM ai_artifacts a
       JOIN agent_runs r ON r.id = ? AND r.user_id = ? AND r.app_id = ?
       WHERE a.id = ? AND a.user_id = ? AND a.status <> 'deleted'
         AND (
           EXISTS (
             SELECT 1 FROM agent_artifact_links l
             WHERE l.artifact_id = a.id AND l.run_id = r.id
           ) OR EXISTS (
             SELECT 1 FROM agent_artifact_grants g
             WHERE g.artifact_id = a.id AND g.receiver_user_id = r.user_id
               AND g.receiver_app_id = r.app_id AND g.receiver_run_id = r.id
               AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?)
           )
         )
         AND (
           (? IS NULL AND EXISTS (
             SELECT 1 FROM agent_runtimes root
             WHERE root.run_id = r.id AND root.participant_id = 'root'
           )) OR
           (? IS NOT NULL AND EXISTS (
             SELECT 1 FROM agent_runtimes rt
             WHERE rt.id = ? AND rt.run_id = r.id AND (
               rt.participant_id = 'root' OR EXISTS (
                 SELECT 1 FROM agent_delegations d
                 WHERE d.run_id = r.id AND d.child_runtime_id = rt.id
                   AND EXISTS (
                     SELECT 1 FROM json_each(d.input_artifact_refs_json) refs
                     WHERE refs.value = a.id
                   )
               )
             )
           ))
         )
       LIMIT 1`,
      [
        access.runId,
        scope.userId,
        scope.appId,
        artifactId,
        scope.userId,
        now,
        access.runtimeId ?? null,
        access.runtimeId ?? null,
        access.runtimeId ?? null,
      ],
    );
  }

  private async reconcileStaging(row: ArtifactRow, now: number): Promise<boolean> {
    const tmpPath = path.join(this.tmpRoot, `${row.storage_key}.part`);
    const objectPath = this.objectPath(row.storage_key);
    let objectInfo: Awaited<ReturnType<typeof fs.lstat>> | null = null;
    try {
      objectInfo = await fs.lstat(objectPath);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }

    if (objectInfo) {
      if (objectInfo.isSymbolicLink() || !objectInfo.isFile() || objectInfo.size !== row.reserved_bytes) {
        await fs.rm(objectPath, { force: true, recursive: true });
        await fs.rm(tmpPath, { force: true }).catch(() => undefined);
        return this.releaseStaging(row);
      }
      const sha256 = await this.hashFile(objectPath);
      const limits = await this.limits.forUser(row.user_id);
      const finalized = await this.finalizeReady(
        row,
        sha256,
        objectInfo.size,
        now,
        retentionDeadline(now, limits.unretainedArtifactTtlSeconds),
      );
      if (finalized) await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      return finalized;
    }

    // No object means the side effect has not crossed the rename boundary. A partial tmp file is
    // safe to remove once no in-process writer owns the reservation; an unexpired reservation stays
    // staging so the client may retry the upload from byte zero.
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    if (row.expires_at !== null && row.expires_at <= now) return this.releaseStaging(row);
    return false;
  }

  private async hashFile(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    for await (const chunk of stream) hash.update(Buffer.from(chunk));
    return hash.digest('hex');
  }

  private async finalizeReady(
    row: ArtifactRow,
    sha256: string,
    sizeBytes: number,
    readyAt: number,
    expiresAt: number,
  ): Promise<boolean> {
    if (sizeBytes !== row.reserved_bytes) throw new Error('ARTIFACT_SIZE_MISMATCH');
    return this.db.transaction(async (tx) => {
      const changed = await tx.execute(
        `UPDATE ai_artifacts SET
           sha256 = ?, size_bytes = ?, reserved_bytes = 0, status = 'ready',
           ready_at = ?, expires_at = ?, version = version + 1
         WHERE id = ? AND user_id = ? AND app_id = ? AND status = 'staging' AND version = ?`,
        [sha256, sizeBytes, readyAt, expiresAt, row.id, row.user_id, row.app_id, row.version],
      );
      if (changed.changes !== 1) return false;
      const quotaChanged = await tx.execute(
        `UPDATE agent_quota_usage SET
           reserved_bytes = reserved_bytes - ?, used_bytes = used_bytes + ?
         WHERE scope_key = ? AND reserved_bytes >= ?`,
        [row.reserved_bytes, sizeBytes, quotaKey(row.user_id), row.reserved_bytes],
      );
      if (quotaChanged.changes !== 1) throw new Error('ARTIFACT_QUOTA_STATE_INVALID');
      return true;
    });
  }

  private async finalizeDeleting(row: ArtifactRow, now: number): Promise<boolean> {
    await fs.rm(this.objectPath(row.storage_key), { force: true });
    await fs.rm(path.join(this.tmpRoot, `${row.storage_key}.part`), { force: true }).catch(() => undefined);
    return this.db.transaction(async (tx) => {
      const deleted = await tx.execute(
        `UPDATE ai_artifacts SET status = 'deleted', deleted_at = ?, retained = 0, version = version + 1
         WHERE id = ? AND user_id = ? AND app_id = ? AND status = 'deleting' AND version = ?`,
        [now, row.id, row.user_id, row.app_id, row.version],
      );
      if (deleted.changes !== 1) return false;
      if (row.size_bytes > 0) {
        const quotaChanged = await tx.execute(
          `UPDATE agent_quota_usage SET used_bytes = used_bytes - ?
           WHERE scope_key = ? AND used_bytes >= ?`,
          [row.size_bytes, quotaKey(row.user_id), row.size_bytes],
        );
        if (quotaChanged.changes !== 1) throw new Error('ARTIFACT_QUOTA_STATE_INVALID');
      }
      return true;
    });
  }

  private async releaseStaging(row: ArtifactRow): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    return this.db.transaction(async (tx) => {
      const changed = await tx.execute(
        `UPDATE ai_artifacts SET reserved_bytes = 0, status = 'deleted', deleted_at = ?, version = version + 1
         WHERE id = ? AND user_id = ? AND app_id = ? AND status = 'staging' AND version = ?`,
        [now, row.id, row.user_id, row.app_id, row.version],
      );
      if (changed.changes !== 1) return false;
      const quotaChanged = await tx.execute(
        `UPDATE agent_quota_usage SET reserved_bytes = reserved_bytes - ?
         WHERE scope_key = ? AND reserved_bytes >= ?`,
        [row.reserved_bytes, quotaKey(row.user_id), row.reserved_bytes],
      );
      if (quotaChanged.changes !== 1) throw new Error('ARTIFACT_QUOTA_STATE_INVALID');
      return true;
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
