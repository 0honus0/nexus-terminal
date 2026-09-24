import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { LocalArtifactStore } from '../../packages/backend/src/infrastructure/agent/artifacts/local-artifact-store';
import { DatabaseAdapter } from '../../packages/backend/src/infrastructure/database/database.adapter';
import type { Scope } from '../../packages/backend/src/modules/agent/agent.types';
import type { ArtifactLimitPolicyPort } from '../../packages/backend/src/modules/agent/ai/artifact.port';
import { ArtifactService } from '../../packages/backend/src/modules/agent/ai/artifact.service';

const main = async (): Promise<void> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-artifact-staging-delete-race-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'artifacts.sqlite', nodeEnv: 'test' });
  const limits: ArtifactLimitPolicyPort = {
    forUser: async () => ({
      maxSingleArtifactBytes: 1024 * 1024,
      maxGlobalArtifactBytes: 8 * 1024 * 1024,
      unretainedArtifactTtlSeconds: 60 * 60,
      minFreeDiskBytes: 0,
    }),
  };
  const store = new LocalArtifactStore(db, limits, { dataDirectory: directory, uploadTtlSeconds: 60 });
  const artifacts = new ArtifactService(store);
  const scope: Scope = { userId: 1, appId: 'artifact-race-app' };
  const now = Math.floor(Date.now() / 1000);

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'artifact-race-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', ?, ?)`,
      [scope.appId, now, now],
    );

    const payload = Buffer.from('rename-to-ready-race', 'utf8');
    const reservation = await artifacts.begin(scope, {
      name: 'race.txt',
      mediaType: 'text/plain',
      declaredBytes: payload.byteLength,
    });
    const staging = await artifacts.get(scope, reservation.artifactId);
    assert(staging);

    const internals = store as unknown as {
      finalizeReady: (...args: unknown[]) => Promise<boolean>;
    };
    const originalFinalizeReady = internals.finalizeReady.bind(store);
    let enteredResolve: (() => void) | undefined;
    let releaseResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    internals.finalizeReady = async (...args: unknown[]): Promise<boolean> => {
      enteredResolve?.();
      await release;
      return originalFinalizeReady(...args);
    };

    const writePromise = artifacts.write(
      scope,
      reservation.artifactId,
      Readable.from([payload]),
      new AbortController().signal,
    );
    await entered;

    await assert.rejects(
      artifacts.delete(scope, reservation.artifactId, staging.version),
      /ARTIFACT_UPLOAD_BUSY/,
      'delete must not cross an active writer after tmp->object rename',
    );

    releaseResolve?.();
    const ready = await writePromise;
    assert.equal(ready.status, 'ready');
    internals.finalizeReady = originalFinalizeReady;

    const abandonedPayload = Buffer.from('abandoned-object', 'utf8');
    const abandoned = await artifacts.begin(scope, {
      name: 'abandoned.txt',
      mediaType: 'text/plain',
      declaredBytes: abandonedPayload.byteLength,
    });
    const abandonedRef = await artifacts.get(scope, abandoned.artifactId);
    assert(abandonedRef);
    const storage = await db.queryOne<{ storage_key: string }>('SELECT storage_key FROM ai_artifacts WHERE id = ?', [
      abandoned.artifactId,
    ]);
    assert(storage);
    const objectPath = path.join(
      directory,
      'agent',
      'artifacts',
      'objects',
      storage.storage_key.slice(0, 2),
      storage.storage_key,
    );
    fs.mkdirSync(path.dirname(objectPath), { recursive: true });
    fs.writeFileSync(objectPath, abandonedPayload);

    await artifacts.delete(scope, abandoned.artifactId, abandonedRef.version);
    assert.equal(
      fs.existsSync(objectPath),
      false,
      'staging delete must remove a post-rename object if no writer owns it',
    );
    assert.equal(await artifacts.get(scope, abandoned.artifactId), null);

    const quota = await db.queryOne<{ reserved_bytes: number }>(
      "SELECT reserved_bytes FROM agent_quota_usage WHERE scope_key = 'artifact:user:1'",
    );
    assert.equal(
      quota?.reserved_bytes,
      0,
      'staging delete must release reserved quota through deleting reconciliation',
    );

    process.stdout.write('agent artifact staging delete race regression: PASS\n');
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
