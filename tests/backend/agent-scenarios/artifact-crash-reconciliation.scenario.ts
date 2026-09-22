import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalArtifactStore } from '../../../packages/backend/src/infrastructure/agent/artifacts/local-artifact-store';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ArtifactLimitPolicyPort } from '../../../packages/backend/src/modules/agent/ai/artifact.port';

export const artifactCrashReconciliationScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-artifact-reconcile-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'artifact-reconcile.sqlite', nodeEnv: 'test' });
  const limits: ArtifactLimitPolicyPort = {
    forUser: async () => ({
      maxSingleArtifactBytes: 1024 * 1024,
      maxGlobalArtifactBytes: 8 * 1024 * 1024,
      unretainedArtifactTtlSeconds: 60 * 60,
      minFreeDiskBytes: 0,
    }),
  };
  const store = new LocalArtifactStore(db, limits, { dataDirectory: directory, uploadTtlSeconds: 60 });
  const now = Math.floor(Date.now() / 1000);
  const appId = 'artifact-reconcile-app';
  const objectRoot = path.join(directory, 'agent', 'artifacts', 'objects');
  const tmpRoot = path.join(directory, 'agent', 'artifacts', 'tmp');
  const quotaScope = 'artifact:user:1';
  const payload = Buffer.from('artifact-crash-window-payload'.repeat(8), 'utf8');
  const payloadHash = createHash('sha256').update(payload).digest('hex');

  const insertArtifact = async (input: {
    id: string;
    storageKey: string;
    status: 'staging' | 'deleting';
    reservedBytes: number;
    sizeBytes: number;
    expiresAt: number | null;
    sha256?: string | null;
  }): Promise<void> => {
    await db.execute(
      `INSERT INTO ai_artifacts
        (id, user_id, app_id, original_name, media_type, storage_key, sha256,
         size_bytes, reserved_bytes, status, retained, version, created_at, ready_at, expires_at, deleted_at)
       VALUES (?, 1, ?, ?, 'application/octet-stream', ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, NULL)`,
      [
        input.id,
        appId,
        `${input.id}.bin`,
        input.storageKey,
        input.sha256 ?? null,
        input.sizeBytes,
        input.reservedBytes,
        input.status,
        now - 30,
        input.status === 'deleting' ? now - 20 : null,
        input.expiresAt,
      ],
    );
  };

  try {
    await db.initialize();
    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'artifact-reconcile-user', 'not-used')",
    );
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', ?, ?)`,
      [appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_quota_usage (scope_key, limit_bytes, used_bytes, reserved_bytes)
       VALUES (?, ?, 0, 0)`,
      [quotaScope, 8 * 1024 * 1024],
    );
    fs.mkdirSync(objectRoot, { recursive: true });
    fs.mkdirSync(tmpRoot, { recursive: true });

    // Crash window 1: rename(tmp -> object) completed, ready DB transaction never committed.
    const renamedKey = 'aa-renamed-before-ready';
    await insertArtifact({
      id: 'artifact-renamed-before-ready',
      storageKey: renamedKey,
      status: 'staging',
      reservedBytes: payload.length,
      sizeBytes: 0,
      expiresAt: now + 60,
    });
    await db.execute('UPDATE agent_quota_usage SET reserved_bytes = reserved_bytes + ? WHERE scope_key = ?', [
      payload.length,
      quotaScope,
    ]);
    fs.mkdirSync(path.join(objectRoot, renamedKey.slice(0, 2)), { recursive: true });
    fs.writeFileSync(path.join(objectRoot, renamedKey.slice(0, 2), renamedKey), payload);

    // Abandoned staging before rename: expiry must release reservation and delete the partial tmp file.
    const expiredKey = 'bb-expired-staging';
    await insertArtifact({
      id: 'artifact-expired-staging',
      storageKey: expiredKey,
      status: 'staging',
      reservedBytes: payload.length,
      sizeBytes: 0,
      expiresAt: now - 1,
    });
    await db.execute('UPDATE agent_quota_usage SET reserved_bytes = reserved_bytes + ? WHERE scope_key = ?', [
      payload.length,
      quotaScope,
    ]);
    fs.writeFileSync(path.join(tmpRoot, `${expiredKey}.part`), payload.subarray(0, 16));

    // Crash window 2: deleting was durable, object removal never happened.
    const deletingFileKey = 'cc-deleting-file-present';
    await insertArtifact({
      id: 'artifact-deleting-file-present',
      storageKey: deletingFileKey,
      status: 'deleting',
      reservedBytes: 0,
      sizeBytes: payload.length,
      expiresAt: null,
      sha256: payloadHash,
    });
    await db.execute('UPDATE agent_quota_usage SET used_bytes = used_bytes + ? WHERE scope_key = ?', [
      payload.length,
      quotaScope,
    ]);
    fs.mkdirSync(path.join(objectRoot, deletingFileKey.slice(0, 2)), { recursive: true });
    fs.writeFileSync(path.join(objectRoot, deletingFileKey.slice(0, 2), deletingFileKey), payload);

    // Crash window 3: object removal completed, deleted DB/quota transaction never committed.
    const deletingGoneKey = 'dd-deleting-file-gone';
    await insertArtifact({
      id: 'artifact-deleting-file-gone',
      storageKey: deletingGoneKey,
      status: 'deleting',
      reservedBytes: 0,
      sizeBytes: payload.length,
      expiresAt: null,
      sha256: payloadHash,
    });
    await db.execute('UPDATE agent_quota_usage SET used_bytes = used_bytes + ? WHERE scope_key = ?', [
      payload.length,
      quotaScope,
    ]);

    const repaired = await store.reconcile(32);
    assert.equal(repaired, 4);

    const renamed = await db.queryOne<{
      status: string;
      sha256: string | null;
      size_bytes: number;
      reserved_bytes: number;
    }>('SELECT status, sha256, size_bytes, reserved_bytes FROM ai_artifacts WHERE id = ?', [
      'artifact-renamed-before-ready',
    ]);
    assert.deepEqual(renamed, {
      status: 'ready',
      sha256: payloadHash,
      size_bytes: payload.length,
      reserved_bytes: 0,
    });
    assert.equal(
      (
        await db.queryOne<{ status: string }>('SELECT status FROM ai_artifacts WHERE id = ?', [
          'artifact-expired-staging',
        ])
      )?.status,
      'deleted',
    );
    assert.equal(fs.existsSync(path.join(tmpRoot, `${expiredKey}.part`)), false);
    for (const [id, storageKey] of [
      ['artifact-deleting-file-present', deletingFileKey],
      ['artifact-deleting-file-gone', deletingGoneKey],
    ] as const) {
      assert.equal(
        (await db.queryOne<{ status: string }>('SELECT status FROM ai_artifacts WHERE id = ?', [id]))?.status,
        'deleted',
      );
      assert.equal(fs.existsSync(path.join(objectRoot, storageKey.slice(0, 2), storageKey)), false);
    }
    const quota = await db.queryOne<{ used_bytes: number; reserved_bytes: number }>(
      'SELECT used_bytes, reserved_bytes FROM agent_quota_usage WHERE scope_key = ?',
      [quotaScope],
    );
    assert.deepEqual(quota, { used_bytes: payload.length, reserved_bytes: 0 });

    // A second pass must be a pure no-op: no duplicate quota transfer or decrement.
    assert.equal(await store.reconcile(32), 0);
    assert.deepEqual(
      await db.queryOne<{ used_bytes: number; reserved_bytes: number }>(
        'SELECT used_bytes, reserved_bytes FROM agent_quota_usage WHERE scope_key = ?',
        [quotaScope],
      ),
      quota,
    );

    return [
      { name: 'artifact_crash_windows_repaired', value: 3, unit: 'windows' },
      { name: 'expired_staging_repaired', value: 1, unit: 'artifacts' },
      { name: 'idempotent_second_pass_repairs', value: 0, unit: 'artifacts' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
