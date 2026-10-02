import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppIntentArtifactAdapter } from '../../../packages/backend/src/infrastructure/agent/artifacts/app-intent-artifact.adapter';
import { LocalArtifactStore } from '../../../packages/backend/src/infrastructure/agent/artifacts/local-artifact-store';
import { BackendPluginProcess } from '../../../packages/backend/src/infrastructure/agent/plugins/local-plugin-backend-runtime.adapter';
import { SqliteAppGrantRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-app-grant.repository';
import { SqliteAppIntentRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-app-intent.repository';
import { SqliteAppStateRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-app-state.repository';
import { SqliteAppStorageRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-app-storage.repository';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ArtifactLimitPolicyPort } from '../../../packages/backend/src/modules/agent/ai/artifact.port';
import { ArtifactService } from '../../../packages/backend/src/modules/agent/ai/artifact.service';
import { AppIntentService } from '../../../packages/backend/src/modules/agent/host/app-intent.service';
import { validateManifest } from '../../../packages/backend/src/modules/agent/host/app-manifest-validator';
import { AppRegistryService } from '../../../packages/backend/src/modules/agent/host/app-registry.service';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';

export const pluginAppIntentSdkScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-plugin-app-intent-sdk-'));
  const db = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'plugin-app-intent-sdk.sqlite',
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
  const registry = new AppRegistryService();
  const states = new SqliteAppStateRepository(db);
  const grants = new SqliteAppGrantRepository(db, new CapabilityRegistry());
  const intentRepository = new SqliteAppIntentRepository(db);
  const storage = new SqliteAppStorageRepository(db);
  let intentNow = Math.floor(Date.now() / 1000);
  const intentClock: ClockPort = { nowUnixSeconds: () => intentNow };
  const intents = new AppIntentService(
    intentRepository,
    registry,
    states,
    grants,
    new AppIntentArtifactAdapter(store),
    intentClock,
  );
  const sender: Scope = { userId: 1, appId: 'fixture.sender' };
  const receiver: Scope = { userId: 1, appId: 'fixture.receiver' };
  const receiverIntent = 'fixture.receive';
  const manifest = (id: string, declaredIntents: Array<{ id: string; schemaVersion: number }>) =>
    validateManifest(
      {
        schemaVersion: 1,
        id,
        version: '1.0.0',
        displayName: id,
        sdkVersion: '1.0.0',
        nexus: { minVersion: '1.0.0', maxVersion: '99.0.0' },
        capabilities: ['app.intents.exchange', 'artifacts.read'],
        intents: declaredIntents,
      },
      { nexusVersion: '1.0.0', supportedSdkMajor: 1 },
    );
  const source = (bytes: Buffer): AsyncIterable<Uint8Array> =>
    (async function* () {
      yield bytes;
    })();
  const writeArtifact = async (name: string, bytes: Buffer) => {
    const reservation = await artifacts.begin(sender, {
      name,
      mediaType: 'application/octet-stream',
      declaredBytes: bytes.byteLength,
    });
    return artifacts.write(sender, reservation.artifactId, source(bytes), new AbortController().signal);
  };
  const readAll = async (stream: AsyncIterable<Uint8Array>): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  const exchangeGrant = {
    capability: 'app.intents.exchange' as const,
    schemaVersion: 2 as const,
    scope: { kind: 'global' } as const,
    grantedAt: intentNow,
  };
  const artifactGrant = {
    capability: 'artifacts.read' as const,
    schemaVersion: 2 as const,
    scope: { kind: 'global' } as const,
    grantedAt: intentNow,
  };

  try {
    await db.initialize();
    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'plugin-app-intent-sdk-user', 'not-used')",
    );
    registry.registerVersion({
      manifest: manifest(sender.appId, []),
      defaultEnabled: true,
      defaultGrants: [],
    });
    registry.registerVersion({
      manifest: manifest(receiver.appId, [{ id: receiverIntent, schemaVersion: 1 }]),
      defaultEnabled: true,
      defaultGrants: [],
    });
    for (const scope of [sender, receiver]) {
      await states.insertDefault({
        userId: scope.userId,
        appId: scope.appId,
        activeVersion: '1.0.0',
        desiredState: 'enabled',
        observedState: 'running',
        healthReason: null,
        policyRevision: 1,
        runningCount: 0,
        approvalCount: 0,
        budgetRequestCount: 0,
        acceptNewRuns: true,
        version: 1,
        createdAt: intentNow,
        updatedAt: intentNow,
      });
      await grants.insertDefaults(scope, [exchangeGrant, artifactGrant]);
    }

    const primaryBytes = Buffer.from('plugin-app-intent-range');
    const primaryArtifact = await writeArtifact('primary.bin', primaryBytes);
    await assert.rejects(
      () =>
        intents.createConfirmed(sender, {
          receiverAppId: receiver.appId,
          intentId: 'fixture.undeclared',
          input: { kind: 'undeclared' },
          artifactRefs: [],
          confirmed: true,
        }),
      /APP_INTENT_UNDECLARED/,
      'Plugin AppIntent must reject an intent not declared by the receiver manifest',
    );

    await db.execute('DELETE FROM agent_app_grants WHERE user_id = ? AND app_id = ?', [
      receiver.userId,
      receiver.appId,
    ]);
    await assert.rejects(
      () =>
        intents.createConfirmed(sender, {
          receiverAppId: receiver.appId,
          intentId: receiverIntent,
          input: { kind: 'missing-grant' },
          artifactRefs: [{ appId: sender.appId, id: primaryArtifact.id }],
          confirmed: true,
        }),
      /APP_INTENT_RECEIVER_GRANT_DENIED/,
      'Plugin AppIntent Artifact transfer must reject a receiver without artifacts.read grant',
    );
    await grants.insertDefaults(receiver, [exchangeGrant]);
    await assert.rejects(
      () =>
        intents.createConfirmed(sender, {
          receiverAppId: receiver.appId,
          intentId: receiverIntent,
          input: { kind: 'missing-artifact-read' },
          artifactRefs: [{ appId: sender.appId, id: primaryArtifact.id }],
          confirmed: true,
        }),
      /APP_INTENT_RECEIVER_GRANT_DENIED/,
      'Plugin AppIntent Artifact transfer must independently require artifacts.read after exchange authority is granted',
    );
    await grants.insertDefaults(receiver, [artifactGrant]);

    const runtimeRoot = path.join(directory, 'plugin-runtime');
    const runtimeBackend = path.join(runtimeRoot, 'backend');
    fs.mkdirSync(runtimeBackend, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeBackend, 'index.mjs'),
      `const operationId = '00000000-0000-4000-8000-000000000104';

export default {
  async activate(context) {
    const request = {
      operationId,
      receiverAppId: 'fixture.receiver',
      intentId: 'fixture.receive',
      input: { kind: 'runtime-idempotency' },
      artifactRefs: [],
      confirmed: true,
    };
    const first = await context.sdk.intents.create(request);
    const replay = await context.sdk.intents.create(request);
    let mismatch = null;
    try {
      await context.sdk.intents.create({ ...request, input: { kind: 'runtime-idempotency-changed' } });
    } catch (error) {
      mismatch = error instanceof Error ? error.message : String(error);
    }
    await context.sdk.storage.put(
      'runtime.intent-idempotency',
      { operationId, firstId: first.id, replayId: replay.id, mismatch },
      null,
    );
  },
};
`,
      'utf8',
    );
    const workerPath = path.resolve(
      __dirname,
      '../../../packages/backend/src/infrastructure/agent/plugins/plugin-backend-runtime.worker.ts',
    );
    const tsxBin = path.resolve(__dirname, '../../../packages/backend/node_modules/.bin/tsx');
    const child = spawn(tsxBin, [workerPath], {
      cwd: runtimeRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        NEXUS_PLUGIN_USER_ID: String(sender.userId),
        NEXUS_PLUGIN_APP_ID: sender.appId,
        NEXUS_PLUGIN_VERSION: '1.0.0',
        NEXUS_PLUGIN_SDK_VERSION: '1.0.0',
        NEXUS_PLUGIN_PROTOCOL_VERSION: '1',
        NEXUS_PLUGIN_BACKEND_ENTRY: 'backend/index.mjs',
        NEXUS_PLUGIN_ROOT: runtimeRoot,
      },
    });
    const runtime = new BackendPluginProcess(child, sender, storage, intents, true, '1.0.0');
    try {
      await runtime.ready;
      await runtime.request('lifecycle.activate');
      const runtimeResult = await storage.get(sender, 'runtime.intent-idempotency');
      assert.deepEqual(runtimeResult?.value, {
        operationId: '00000000-0000-4000-8000-000000000104',
        firstId: '00000000-0000-4000-8000-000000000104',
        replayId: '00000000-0000-4000-8000-000000000104',
        mismatch: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      });
      const runtimeReceipts = (await intents.listReceived(receiver)).filter(
        (candidate) => candidate.id === '00000000-0000-4000-8000-000000000104',
      );
      assert.equal(runtimeReceipts.length, 1, 'Backend Plugin retry must replay one durable AppIntent receipt');
    } finally {
      await runtime.close();
    }

    const receipt = await intents.createConfirmed(sender, {
      receiverAppId: receiver.appId,
      intentId: receiverIntent,
      input: { kind: 'bounded', label: 'fixture' },
      artifactRefs: [{ appId: sender.appId, id: primaryArtifact.id }],
      confirmed: true,
    });
    const received = await intents.listReceived(receiver);
    assert.ok(
      received.some((candidate) => candidate.id === receipt.id),
      'Receiver Plugin must list its AppIntent receipt',
    );
    const metadata = await intents.getReceivedArtifact(receiver, receipt.id, primaryArtifact.id);
    assert.equal(metadata.id, primaryArtifact.id);
    assert.equal(metadata.sizeBytes, primaryBytes.byteLength);
    const range = await intents.readReceivedArtifact(receiver, receipt.id, primaryArtifact.id, {
      start: 7,
      endInclusive: 16,
    });
    assert.equal((await readAll(range.source)).toString('utf8'), primaryBytes.subarray(7, 17).toString('utf8'));

    await intents.revoke(sender, receipt.id);
    await assert.rejects(
      () => intents.getReceivedArtifact(receiver, receipt.id, primaryArtifact.id),
      /APP_INTENT_NOT_FOUND/,
      'Revoked AppIntent receipts must stop granting Artifact access',
    );

    const ttlArtifact = await writeArtifact('ttl.bin', Buffer.from('ttl'));
    const ttlReceipt = await intents.createConfirmed(sender, {
      receiverAppId: receiver.appId,
      intentId: receiverIntent,
      input: { kind: 'ttl' },
      artifactRefs: [{ appId: sender.appId, id: ttlArtifact.id }],
      confirmed: true,
    });
    const expiredArtifact = await writeArtifact('expired.bin', Buffer.from('expired'));
    const expiredArtifactReceipt = await intents.createConfirmed(sender, {
      receiverAppId: receiver.appId,
      intentId: receiverIntent,
      input: { kind: 'artifact-expired' },
      artifactRefs: [{ appId: sender.appId, id: expiredArtifact.id }],
      confirmed: true,
    });
    await db.execute("UPDATE ai_artifacts SET status = 'deleted', expires_at = ?, deleted_at = ? WHERE id = ?", [
      intentNow - 1,
      intentNow,
      expiredArtifact.id,
    ]);
    await assert.rejects(
      () => intents.getReceivedArtifact(receiver, expiredArtifactReceipt.id, expiredArtifact.id),
      /APP_INTENT_ARTIFACT_NOT_FOUND/,
      'An expired or swept source Artifact must not stay readable through an AppIntent receipt',
    );

    intentNow += 601;
    assert.ok(
      !(await intents.listReceived(receiver)).some((candidate) => candidate.id === ttlReceipt.id),
      'Expired AppIntent receipts must disappear from receiver listing',
    );
    await assert.rejects(
      () => intents.getReceivedArtifact(receiver, ttlReceipt.id, ttlArtifact.id),
      /APP_INTENT_NOT_FOUND/,
      'Expired AppIntent receipts must stop granting Artifact access',
    );

    return [
      { name: 'plugin_app_intent_authority_roundtrips', value: 2, unit: 'cases' },
      { name: 'plugin_backend_intent_idempotent_replays', value: 1, unit: 'receipts' },
      { name: 'plugin_app_intent_authority_rejections', value: 5, unit: 'cases' },
    ];
  } finally {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
