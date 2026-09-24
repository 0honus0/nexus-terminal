import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteAppStorageRepository } from '../../packages/backend/src/infrastructure/agent/repositories/sqlite-app-storage.repository';
import { DatabaseAdapter } from '../../packages/backend/src/infrastructure/database/database.adapter';
import type { Scope } from '../../packages/backend/src/modules/agent/agent.types';
import type { AppStorageSnapshot } from '../../packages/backend/src/modules/agent/host/app-storage-snapshot.port';

const main = async (): Promise<void> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-app-storage-quota-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'storage.sqlite', nodeEnv: 'test' });
  const scope: Scope = { userId: 1, appId: 'storage-quota-app' };
  const now = Math.floor(Date.now() / 1000);

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'storage-quota-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', ?, ?)`,
      [scope.appId, now, now],
    );
    const repository = new SqliteAppStorageRepository(db);

    await db.transaction(async (tx) => {
      for (let index = 0; index < 4096; index += 1) {
        const key = `entry-${index.toString().padStart(4, '0')}`;
        await tx.execute(
          `INSERT INTO agent_app_storage(user_id,app_id,key,value_json,bytes,version,updated_at)
           VALUES(1,?,?,?,?,1,?)`,
          [scope.appId, key, '0', 1, now],
        );
      }
    });
    await assert.rejects(
      repository.put(scope, 'entry-overflow', 0, null),
      /APP_STORAGE_QUOTA_EXCEEDED/,
      'per-App entry count must bound millions of tiny values',
    );

    await repository.clear(scope);

    const value = 'x'.repeat(65_534);
    const valueBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    assert.equal(valueBytes, 64 * 1024);
    const entries: AppStorageSnapshot['entries'] = Array.from({ length: 255 }, (_, index) => {
      const prefix = index.toString().padStart(4, '0');
      const key = `${prefix}-${'k'.repeat(251)}`;
      assert.equal(Buffer.byteLength(key, 'utf8'), 256);
      return { key, value, bytes: valueBytes, version: 1, updatedAt: now };
    });
    const snapshot: AppStorageSnapshot = {
      entries,
      totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    };
    assert(snapshot.totalBytes < 16 * 1024 * 1024, 'legacy value-only accounting would accept this snapshot');
    await assert.rejects(
      repository.restore(scope, snapshot),
      /APP_STORAGE_SNAPSHOT_INVALID/,
      'snapshot restore must include key and row/index overhead in the same quota',
    );

    await repository.restore(scope, {
      entries: [
        {
          key: 'small-a',
          value: { ok: true },
          bytes: Buffer.byteLength(JSON.stringify({ ok: true })),
          version: 1,
          updatedAt: now,
        },
        { key: 'small-b', value: 0, bytes: 1, version: 1, updatedAt: now },
      ],
      totalBytes: Buffer.byteLength(JSON.stringify({ ok: true })) + 1,
    });
    assert.equal((await repository.stats(scope)).entryCount, 2);

    process.stdout.write('agent app storage quota regression: PASS\n');
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
