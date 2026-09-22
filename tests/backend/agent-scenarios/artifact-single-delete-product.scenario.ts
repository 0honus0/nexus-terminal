import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { LocalArtifactStore } from '../../../packages/backend/src/infrastructure/agent/artifacts/local-artifact-store';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ArtifactLimitPolicyPort } from '../../../packages/backend/src/modules/agent/ai/artifact.port';
import { ArtifactService } from '../../../packages/backend/src/modules/agent/ai/artifact.service';

export const artifactSingleDeleteProductScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-artifact-single-delete-'));
  const db = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'artifact-single-delete.sqlite',
    nodeEnv: 'test',
  });
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
  const artifactScope: Scope = { userId: 1, appId: 'artifact-single-delete-app' };
  const now = Math.floor(Date.now() / 1000);

  const createReadyArtifact = async (name: string, content: string) => {
    const payload = Buffer.from(content, 'utf8');
    const reservation = await artifacts.begin(artifactScope, {
      name,
      mediaType: 'text/plain',
      declaredBytes: payload.byteLength,
    });
    return artifacts.write(
      artifactScope,
      reservation.artifactId,
      Readable.from([payload]),
      new AbortController().signal,
    );
  };

  try {
    await db.initialize();
    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'artifact-single-delete-user', 'not-used')",
    );
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', ?, ?)`,
      [artifactScope.appId, now, now],
    );

    const artifactA = await createReadyArtifact('delete-only-a.txt', 'delete exactly artifact A');
    const artifactB = await createReadyArtifact('keep-b.txt', 'artifact B must remain');
    const beforeDelete = await artifacts.storageSummary(artifactScope.userId);
    assert.equal(beforeDelete.totalBytes, artifactA.sizeBytes + artifactB.sizeBytes);

    await artifacts.delete(artifactScope, artifactA.id, artifactA.version);
    assert.equal(await artifacts.get(artifactScope, artifactA.id), null, 'single delete must remove only the target');
    assert.equal(
      (await artifacts.get(artifactScope, artifactB.id))?.status,
      'ready',
      'another reclaimable Artifact must survive a single delete',
    );
    const afterDelete = await artifacts.storageSummary(artifactScope.userId);
    assert.equal(afterDelete.totalBytes, artifactB.sizeBytes, 'storage summary must reflect the exact deleted bytes');
    const cleanupAfterSingleDelete = await artifacts.cleanupPreview(artifactScope.userId);
    assert.equal(cleanupAfterSingleDelete.selectedCount, 1, 'global cleanup remains a separate bulk selection');
    assert.equal(cleanupAfterSingleDelete.selectedBytes, artifactB.sizeBytes);

    const stale = await createReadyArtifact('stale-version.txt', 'stale version must fail closed');
    const retainedOnce = await artifacts.retain(artifactScope, stale.id, true, stale.version);
    const currentStale = await artifacts.retain(artifactScope, stale.id, false, retainedOnce.version);
    await assert.rejects(
      artifacts.delete(artifactScope, stale.id, stale.version),
      /STATE_CONFLICT/,
      'stale expectedVersion must fail without deleting the Artifact',
    );
    assert.equal((await artifacts.get(artifactScope, stale.id))?.version, currentStale.version);

    const retained = await createReadyArtifact('retained.txt', 'retained artifact');
    const retainedCurrent = await artifacts.retain(artifactScope, retained.id, true, retained.version);
    await assert.rejects(
      artifacts.delete(artifactScope, retainedCurrent.id, retainedCurrent.version),
      /ARTIFACT_PROTECTED/,
      'retained Artifact protection must remain Backend-authoritative',
    );
    assert.equal((await artifacts.get(artifactScope, retained.id))?.status, 'ready');

    const protectedArtifact = await createReadyArtifact('active-run-evidence.txt', 'active run protects this artifact');
    const threadId = randomUUID();
    const runId = randomUUID();
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES (?, 1, ?, 'artifact delete protection', 'manual', ?, ?)`,
      [threadId, artifactScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, ?, 'running', 'in_progress', 'not_started', '{}', '{}', '{}', '{}', 0, ?, ?, ?)`,
      [runId, artifactScope.appId, threadId, now, now, now],
    );
    await db.execute(
      `INSERT INTO agent_artifact_links (artifact_id, run_id, role, created_at)
       VALUES (?, ?, 'evidence', ?)`,
      [protectedArtifact.id, runId, now],
    );
    await assert.rejects(
      artifacts.delete(artifactScope, protectedArtifact.id, protectedArtifact.version),
      /ARTIFACT_PROTECTED/,
      'Artifact referenced by an active Run must fail closed',
    );
    assert.equal((await artifacts.get(artifactScope, protectedArtifact.id))?.status, 'ready');

    await assert.rejects(
      artifacts.delete(artifactScope, randomUUID(), 1),
      /NOT_FOUND/,
      'missing Artifact must remain a stable not-found failure',
    );

    return [
      { name: 'artifact_single_delete_targets', value: 1, unit: 'artifacts' },
      { name: 'artifact_single_delete_other_survivors', value: 1, unit: 'artifacts' },
      { name: 'artifact_delete_conflict_fail_closed', value: 1, unit: 'cases' },
      { name: 'artifact_delete_protected_fail_closed', value: 2, unit: 'cases' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
