import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentNotificationBridge } from '../../../packages/backend/src/bootstrap/agent/agent-notification-bridge';
import { SqliteAppStateRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-app-state.repository';
import { SqliteMemoryRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-memory.repository';
import { SqliteRecallRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-recall.repository';
import { SqliteRunRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { AuditLogService } from '../../../packages/backend/src/modules/audit/audit.service';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import { MemoryService } from '../../../packages/backend/src/modules/agent/ai/memory.service';
import { AppRegistryService } from '../../../packages/backend/src/modules/agent/host/app-registry.service';
import { validateManifest } from '../../../packages/backend/src/modules/agent/host/app-manifest-validator';

export const memoryProductClosureScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-memory-product-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'memory-product.sqlite', nodeEnv: 'test' });
  let memoryNow = Math.floor(Date.now() / 1000);
  const memoryClock: ClockPort = { nowUnixSeconds: () => memoryNow };
  const registry = new AppRegistryService();
  const memoryRepository = new SqliteMemoryRepository(db);
  const recall = new RecallService(new SqliteRecallRepository(db), memoryClock);
  const audit = new AuditLogService({
    add: async () => undefined,
    list: async () => ({ logs: [], total: 0 }),
  });
  const hookActions: string[] = [];
  const memories = new MemoryService(
    memoryRepository,
    registry,
    { assertRuntime: async () => undefined },
    audit,
    memoryClock,
    { memoryChanged: async (_memory, action) => void hookActions.push(action) },
  );
  const sourceScope: Scope = { userId: 1, appId: 'fixture.memorysource' };
  const targetScope: Scope = { userId: 1, appId: 'fixture.memorytarget' };
  const memoryManifest = (id: string, intents: Array<{ id: string; schemaVersion: number }>) =>
    validateManifest(
      {
        schemaVersion: 1,
        id,
        version: '1.0.0',
        displayName: id,
        sdkVersion: '1.0.0',
        nexus: { minVersion: '1.0.0', maxVersion: '99.0.0' },
        capabilities: [],
        intents,
      },
      { nexusVersion: '1.0.0', supportedSdkMajor: 1 },
    );

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'memory-product-user', 'not-used')");
    registry.registerVersion({
      manifest: memoryManifest(sourceScope.appId, []),
      defaultEnabled: true,
      defaultGrants: [],
    });
    registry.registerVersion({
      manifest: memoryManifest(targetScope.appId, [{ id: 'memory.import', schemaVersion: 1 }]),
      defaultEnabled: true,
      defaultGrants: [],
    });
    const memoryStates = new SqliteAppStateRepository(db);
    for (const scope of [sourceScope, targetScope]) {
      await memoryStates.insertDefault({
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
        createdAt: memoryNow,
        updatedAt: memoryNow,
      });
    }

    const candidate = await memories.propose(sourceScope, {
      content: 'candidate zebra recall token',
      sourceRefs: { kind: 'scenario', runId: 'memory-run' },
      confidence: 0.8,
      expiresAt: null,
    });
    assert.equal(
      (await recall.recall(sourceScope, 'zebra', 5, 4096)).length,
      0,
      'Candidate Memory must not enter Recall',
    );

    const notificationEvents: Array<{ event: string; details: unknown }> = [];
    const bridge = new AgentNotificationBridge(
      {
        publish: async (event, details) => {
          notificationEvents.push({ event, details });
        },
      },
      { getThread: async () => null },
    );
    await bridge.projectMemoryCandidate(candidate, { runId: 'memory-run', runtimeId: 'memory-runtime' });
    await bridge.projectMemoryCandidate(candidate, { runId: 'memory-run', runtimeId: 'memory-runtime' });
    assert.equal(
      notificationEvents.length,
      1,
      'Memory candidate attention projection must deduplicate by Memory version',
    );
    assert.equal(notificationEvents[0]?.event, 'AGENT_ATTENTION_REQUIRED');
    assert.equal((notificationEvents[0]?.details as { attentionKind?: string })?.attentionKind, 'memory_review');
    assert.doesNotMatch(
      JSON.stringify(notificationEvents[0]?.details),
      /candidate zebra recall token/,
      'Memory notification projection must not copy candidate content into notification details',
    );

    const published = await memories.review(sourceScope, candidate.id, {
      decision: 'publish',
      expectedVersion: candidate.version,
      content: 'published quartz recall token',
    });
    assert.equal(published.status, 'published');
    assert.equal(published.version, candidate.version + 1);
    assert.ok(
      (await recall.recall(sourceScope, 'quartz', 5, 4096)).some((item) => item.id === published.id),
      'Published Memory must enter Recall with edited content',
    );
    await assert.rejects(
      () => memories.review(sourceScope, candidate.id, { decision: 'revoke', expectedVersion: candidate.version }),
      /MEMORY_VERSION_CONFLICT/,
      'Stale Memory review must fail optimistic concurrency',
    );
    const revoked = await memories.review(sourceScope, published.id, {
      decision: 'revoke',
      expectedVersion: published.version,
    });
    assert.equal(revoked.status, 'revoked');
    assert.equal((await recall.recall(sourceScope, 'quartz', 5, 4096)).length, 0, 'Revoked Memory must leave Recall');

    const rejectedCandidate = await memories.propose(sourceScope, {
      content: 'rejectable amber recall token',
      sourceRefs: { kind: 'scenario' },
      confidence: 0.5,
      expiresAt: null,
    });
    await memories.review(sourceScope, rejectedCandidate.id, {
      decision: 'reject',
      expectedVersion: rejectedCandidate.version,
    });
    assert.equal(
      (await recall.recall(sourceScope, 'amber', 5, 4096)).length,
      0,
      'Rejected Memory must never enter Recall',
    );

    const expiringCandidate = await memories.propose(sourceScope, {
      content: 'expiring cobalt recall token',
      sourceRefs: { kind: 'scenario' },
      confidence: 0.7,
      expiresAt: memoryNow + 2,
    });
    await memories.review(sourceScope, expiringCandidate.id, {
      decision: 'publish',
      expectedVersion: expiringCandidate.version,
    });
    memoryNow += 3;
    assert.equal(
      (await recall.recall(sourceScope, 'cobalt', 5, 4096)).length,
      0,
      'Expired published Memory must leave Recall',
    );

    const importCandidate = await memories.propose(sourceScope, {
      content: 'importable indigo memory',
      sourceRefs: { kind: 'scenario' },
      confidence: 0.9,
      expiresAt: null,
    });
    await assert.rejects(
      () => memories.previewImport(targetScope, sourceScope.appId, importCandidate.id),
      /MEMORY_NOT_IMPORTABLE/,
      'Cross-App import preview must reject candidate Memory',
    );
    const importPublished = await memories.review(sourceScope, importCandidate.id, {
      decision: 'publish',
      expectedVersion: importCandidate.version,
    });
    const staleConfirmation = await memories.previewImport(targetScope, sourceScope.appId, importPublished.id);
    await memories.review(sourceScope, importPublished.id, {
      decision: 'revoke',
      expectedVersion: importPublished.version,
    });
    await assert.rejects(
      () => memories.confirmImport(targetScope, staleConfirmation.id),
      /MEMORY_IMPORT_SOURCE_CHANGED/,
      'Cross-App import confirmation must fail if the source Memory changes',
    );

    const successfulSourceCandidate = await memories.propose(sourceScope, {
      content: 'successful violet imported memory',
      sourceRefs: { kind: 'scenario' },
      confidence: 0.95,
      expiresAt: null,
    });
    const successfulSource = await memories.review(sourceScope, successfulSourceCandidate.id, {
      decision: 'publish',
      expectedVersion: successfulSourceCandidate.version,
    });
    const successfulConfirmation = await memories.previewImport(targetScope, sourceScope.appId, successfulSource.id);
    const imported = await memories.confirmImport(targetScope, successfulConfirmation.id);
    assert.equal(imported.status, 'published');
    assert.equal((imported.sourceRefs as { kind?: string }).kind, 'cross_app_import');
    assert.ok(
      (await recall.recall(targetScope, 'violet', 5, 4096)).some((item) => item.id === imported.id),
      'Confirmed cross-App import must create published Recallable Memory in the target App',
    );

    const oneShotCandidate = await memories.propose(sourceScope, {
      content: 'one shot turquoise imported memory',
      sourceRefs: { kind: 'scenario' },
      confidence: 0.91,
      expiresAt: null,
    });
    const oneShotSource = await memories.review(sourceScope, oneShotCandidate.id, {
      decision: 'publish',
      expectedVersion: oneShotCandidate.version,
    });
    const oneShotConfirmation = await memories.previewImport(targetScope, sourceScope.appId, oneShotSource.id);
    const oneShotResults = await Promise.allSettled([
      memories.confirmImport(targetScope, oneShotConfirmation.id),
      memories.confirmImport(targetScope, oneShotConfirmation.id),
    ]);
    assert.equal(
      oneShotResults.filter((result) => result.status === 'fulfilled').length,
      1,
      'A Memory import confirmation must be atomically consumed and succeed at most once',
    );
    assert.equal(
      oneShotResults.filter(
        (result) => result.status === 'rejected' && /MEMORY_IMPORT_CONFIRMATION_NOT_FOUND/.test(String(result.reason)),
      ).length,
      1,
      'Concurrent reuse of an already-consumed Memory import confirmation must fail closed',
    );

    const expirySourceCandidate = await memories.propose(sourceScope, {
      content: 'confirmation silver expiry memory',
      sourceRefs: { kind: 'scenario' },
      confidence: 0.6,
      expiresAt: null,
    });
    const expirySource = await memories.review(sourceScope, expirySourceCandidate.id, {
      decision: 'publish',
      expectedVersion: expirySourceCandidate.version,
    });
    const expiringConfirmation = await memories.previewImport(targetScope, sourceScope.appId, expirySource.id);
    memoryNow += 601;
    await assert.rejects(
      () => memories.confirmImport(targetScope, expiringConfirmation.id),
      /MEMORY_IMPORT_CONFIRMATION_EXPIRED/,
      'Cross-App import confirmation must fail after its bounded TTL',
    );

    const hostEvents = await new SqliteRunRepository(db).readHostEvents(sourceScope.userId, 0, 100);
    assert.ok(
      hostEvents.some((event) => event.type === 'memory.changed'),
      'Memory mutations must commit durable memory.changed Host events',
    );
    assert.ok(hookActions.includes('proposed') && hookActions.includes('publish') && hookActions.includes('revoke'));

    return [
      { name: 'memory_recall_state_cases', value: 5, unit: 'cases' },
      { name: 'memory_import_fail_closed_cases', value: 4, unit: 'cases' },
      { name: 'memory_import_one_shot_confirmations', value: 1, unit: 'confirmations' },
      { name: 'memory_notification_owners', value: 1, unit: 'bridges' },
      { name: 'memory_notification_content_leaks', value: 0, unit: 'fields' },
    ];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
