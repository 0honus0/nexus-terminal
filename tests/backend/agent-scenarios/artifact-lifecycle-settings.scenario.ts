import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalArtifactStore } from '../../../packages/backend/src/infrastructure/agent/artifacts/local-artifact-store';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import {
  createDefaultAgentSettings,
  normalizeRequestedSettings,
} from '../../../packages/backend/src/modules/agent/agent-defaults';
import { ArtifactService } from '../../../packages/backend/src/modules/agent/ai/artifact.service';
import type { ArtifactLimitPolicyPort } from '../../../packages/backend/src/modules/agent/ai/artifact.port';

export const artifactLifecycleSettingsScenario = async () => {
  const defaults = createDefaultAgentSettings();
  assert.equal(
    'workspaceIdleTtlSeconds' in defaults.workspaceRuntime,
    false,
    'P-094 must not expose an idle Workspace setting until Workspace activity has a trustworthy runtime owner',
  );
  assert.equal(
    'workspaceIdleTtlSeconds' in defaults.hardLimits,
    false,
    'P-094 must remove the matching fake Workspace idle hard-limit contract',
  );
  const legacyWorkspaceIdle = {
    ...(defaults as unknown as Record<string, unknown>),
    workspaceRuntime: {
      ...(defaults.workspaceRuntime as unknown as Record<string, unknown>),
      workspaceIdleTtlSeconds: 900,
    },
    hardLimits: {
      ...(defaults.hardLimits as unknown as Record<string, unknown>),
      workspaceIdleTtlSeconds: 3_600,
    },
  };
  assert.throws(
    () => normalizeRequestedSettings(legacyWorkspaceIdle),
    /VALIDATION_FAILED/,
    'settings containing removed Workspace idle fields must fail closed',
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-artifact-lifecycle-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'artifact-lifecycle.sqlite', nodeEnv: 'test' });
  const limits = {
    forUser: async () => ({
      maxSingleArtifactBytes: 10,
      maxGlobalArtifactBytes: 100,
      unretainedArtifactTtlSeconds: 2,
      minFreeDiskBytes: 0,
    }),
  } as unknown as ArtifactLimitPolicyPort;
  const store = new LocalArtifactStore(db, limits, { dataDirectory: directory, uploadTtlSeconds: 60 });
  const artifacts = new ArtifactService(store);
  const scope: Scope = { userId: 1, appId: 'artifact-lifecycle-app' };
  const now = Math.floor(Date.now() / 1000);
  const threadId = randomUUID();
  const runId = randomUUID();
  const source = (bytes: Buffer): AsyncIterable<Uint8Array> =>
    (async function* () {
      yield bytes;
    })();
  const writeArtifact = async (name: string, bytes: Buffer) => {
    const reservation = await artifacts.begin(scope, {
      name,
      mediaType: 'application/octet-stream',
      declaredBytes: bytes.byteLength,
    });
    return artifacts.write(scope, reservation.artifactId, source(bytes), new AbortController().signal);
  };

  try {
    await db.initialize();
    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'artifact-lifecycle-user', 'not-used')",
    );
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [scope.appId, now, now],
    );
    const settings = createDefaultAgentSettings();
    settings.storage.maxArtifactBytes = 10;
    settings.storage.maxSingleArtifactBytes = 10;
    settings.storage.maxGlobalArtifactBytes = 100;
    settings.storage.unretainedArtifactTtlSeconds = 2;
    settings.hardLimits.maxArtifactBytes = 10;
    settings.hardLimits.maxSingleArtifactBytes = 10;
    settings.hardLimits.maxGlobalArtifactBytes = 100;
    settings.hardLimits.unretainedArtifactTtlSeconds = 2;
    await db.execute('INSERT INTO agent_settings (user_id, value_json, revision, updated_at) VALUES (1, ?, 1, ?)', [
      JSON.stringify(settings),
      now,
    ]);
    await db.execute(
      `INSERT INTO ai_threads (id, user_id, app_id, title, title_source, created_at, updated_at)
       VALUES (?, 1, ?, 'artifact lifecycle', 'manual', ?, ?)`,
      [threadId, scope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO agent_runs
        (id, user_id, app_id, thread_id, status, goal_status, verification_status,
         budget_json, definition_json, plan_json, usage_json, executing_runtime_count,
         created_at, started_at, updated_at)
       VALUES (?, 1, ?, ?, 'running', 'in_progress', 'not_started', '{}', '{}', '{}', '{}', 1, ?, ?, ?)`,
      [runId, scope.appId, threadId, now, now, now],
    );

    const first = await writeArtifact('first.bin', Buffer.alloc(6, 1));
    const second = await writeArtifact('second.bin', Buffer.alloc(6, 2));
    assert.ok(
      first.expiresAt && first.readyAt && first.expiresAt >= first.readyAt + 1,
      'ready unretained Artifacts must receive a durable retention deadline',
    );
    await artifacts.attach(1, first.id, {
      targetAppId: scope.appId,
      threadId,
      runId,
      role: 'input',
    });
    await db.execute(
      `INSERT INTO agent_artifact_links (artifact_id, run_id, role, created_at)
       VALUES (?, ?, 'evidence', ?)`,
      [first.id, runId, now],
    );
    await assert.rejects(
      () =>
        artifacts.attach(1, second.id, {
          targetAppId: scope.appId,
          threadId,
          runId,
          role: 'input',
        }),
      /ARTIFACT_RUN_QUOTA_EXCEEDED/,
      'the second first-time link must be rejected when it would cross the current per-Run artifact quota',
    );

    settings.storage.maxArtifactBytes = 20;
    settings.hardLimits.maxArtifactBytes = 20;
    await db.execute(
      'UPDATE agent_settings SET value_json = ?, revision = revision + 1, updated_at = ? WHERE user_id = 1',
      [JSON.stringify(settings), now + 1],
    );
    await artifacts.attach(1, second.id, {
      targetAppId: scope.appId,
      threadId,
      runId,
      role: 'input',
    });

    const expired = await writeArtifact('expired.bin', Buffer.from('x'));
    await db.execute('UPDATE ai_artifacts SET expires_at = ? WHERE id = ?', [now - 1, expired.id]);
    const retained = await writeArtifact('retained.bin', Buffer.from('r'));
    const retainedUpdated = await artifacts.retain(scope, retained.id, true, retained.version);
    assert.equal(retainedUpdated.expiresAt, null, 'retained Artifacts must not have an automatic expiry deadline');
    await db.execute('UPDATE ai_artifacts SET expires_at = ? WHERE id = ?', [now - 1, retained.id]);
    const protectedArtifact = await writeArtifact('active-run.bin', Buffer.from('p'));
    await artifacts.attach(1, protectedArtifact.id, {
      targetAppId: scope.appId,
      threadId,
      runId,
      role: 'input',
    });
    await db.execute('UPDATE ai_artifacts SET expires_at = ? WHERE id = ?', [now - 1, protectedArtifact.id]);

    const checkpointArtifact = await writeArtifact('checkpoint.bin', Buffer.from('c'));
    await db.execute(
      `INSERT INTO agent_artifact_links (artifact_id, run_id, role, created_at)
       VALUES (?, ?, 'checkpoint', ?)`,
      [checkpointArtifact.id, runId, now],
    );
    await db.execute('UPDATE ai_artifacts SET expires_at = ? WHERE id = ?', [now - 1, checkpointArtifact.id]);

    const grantedArtifact = await writeArtifact('grant.bin', Buffer.from('g'));
    await db.execute(
      `INSERT INTO agent_artifact_grants
        (id, artifact_id, receiver_user_id, receiver_app_id, receiver_thread_id, receiver_run_id,
         scope_key, role, expires_at, revoked_at, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, 'input', ?, NULL, ?)`,
      [randomUUID(), grantedArtifact.id, scope.appId, threadId, runId, `run:${runId}`, now + 60, now],
    );
    await db.execute('UPDATE ai_artifacts SET expires_at = ? WHERE id = ?', [now - 1, grantedArtifact.id]);

    const swept = await (store as LocalArtifactStore & { sweepExpired(limit?: number): Promise<number> }).sweepExpired(
      20,
    );
    assert.ok(swept >= 1, 'expired reclaimable Artifacts must be swept');
    assert.equal(await artifacts.get(scope, expired.id), null, 'expired reclaimable Artifact must be deleted');
    assert.equal((await artifacts.get(scope, retained.id))?.status, 'ready');
    assert.equal((await artifacts.get(scope, protectedArtifact.id))?.status, 'ready');
    assert.equal((await artifacts.get(scope, checkpointArtifact.id))?.status, 'ready');
    assert.equal((await artifacts.get(scope, grantedArtifact.id))?.status, 'ready');

    return [
      { name: 'artifact_run_quota_rejections', value: 1, unit: 'cases' },
      { name: 'artifact_run_quota_current_setting_updates', value: 1, unit: 'cases' },
      { name: 'artifact_run_quota_distinct_link_accounting', value: 1, unit: 'cases' },
      { name: 'artifact_ready_ttl_deadlines', value: 1, unit: 'cases' },
      { name: 'artifact_expiry_sweeps', value: swept, unit: 'artifacts' },
      { name: 'artifact_expiry_protected_cases', value: 4, unit: 'artifacts' },
      { name: 'workspace_idle_fake_settings', value: 0, unit: 'settings' },
    ];
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
