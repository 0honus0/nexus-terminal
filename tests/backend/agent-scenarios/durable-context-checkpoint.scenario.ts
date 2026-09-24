import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteConversationRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-conversation.repository';
import { SqliteContextCheckpointRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-context-checkpoint.repository';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { runMigrations } from '../../../packages/backend/src/infrastructure/database/sqlite-migrations';
import { ContextCheckpointService } from '../../../packages/backend/src/modules/agent/ai/context-checkpoint.service';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import type { LedgerEntryView } from '../../../packages/backend/src/modules/agent/ai/conversation.repository.port';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import { SkillRegistry } from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import { clock, emptyModelContinuations, scope } from './scenario-fixtures';
import {
  assertValidToolExchange,
  contextService,
  EmptyRecallRepository,
  entry,
  StaticConversationRepository,
} from './scenario-context-helpers';

export const durableContextCheckpointScenario = async () => {
  const history: LedgerEntryView[] = [
    entry(1, 'user_input', { text: 'Project objective: repair the parser without changing generated files.' }),
    entry(2, 'assistant_message', { text: 'Confirmed the repository constraint and started inspection.' }),
    entry(3, 'assistant_message', {
      text: 'FAILED ATTEMPT: the XML patch approach was ruled out because it corrupts source maps. Never retry XML patch.',
    }),
  ];
  for (let sequence = 4; sequence <= 210; sequence += 1) {
    history.push(
      entry(sequence, sequence % 2 === 0 ? 'user_input' : 'assistant_message', {
        text:
          sequence % 2 === 0
            ? `Routine historical request ${sequence}: inspect the parser state and continue safely. ${'history '.repeat(18)}`
            : `Routine historical response ${sequence}: inspected the parser state. ${'analysis '.repeat(18)}`,
      }),
    );
  }
  const service = contextService(history);
  const plan = await service.compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Proceed with the next implementation step.',
    goal: 'GOAL_MARKER: preserve parser correctness and generated-file immutability.',
    taskPlan: 'PLAN_MARKER: inspect, patch source only, run deterministic verification.',
    collaborationContext: 'COLLAB_MARKER: child parser audit completed; no active child work remains.',
    modelContextWindow: 4_096,
    maxContextTokens: 1_050,
    reservedOutputTokens: 256,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    compactionMode: 'balanced',
    tools: [],
  });
  assert.equal(plan.compacted, true, 'fixture must trigger history compaction');
  assert.ok(
    plan.tokenDiagnostics.summaryCheckpointTokens > 0,
    'compaction must project a durable verified Context checkpoint instead of only dropping old raw Ledger',
  );
  const encoded = JSON.stringify(plan.messages);
  assert.match(
    encoded,
    /XML patch approach was ruled out/,
    'derived checkpoint must retain failed\/ruled-out attempts outside the recent verbatim tail',
  );
  assert.match(encoded, /GOAL_MARKER/, 'current Goal must be reserved ahead of raw history');
  assert.match(encoded, /PLAN_MARKER/, 'current Plan must be reserved ahead of raw history');
  assert.match(encoded, /COLLAB_MARKER/, 'current Collaboration state must be reserved ahead of raw history');
  const checkpointSource = plan.sourceRanges.find((source) => source.kind === 'summary_checkpoint');
  assert.match(
    checkpointSource?.hash ?? '',
    /^[a-f0-9]{64}$/,
    'Context lineage must include the verified checkpoint source hash so regenerated summaries change contextEpoch',
  );
  assertValidToolExchange(plan.messages);

  const fallbackRepository = new StaticConversationRepository(history);
  const fallbackConversations = new ConversationService(fallbackRepository, clock, null!, null!);
  const failingCheckpoints = new ContextCheckpointService(
    {
      getExact: async () => {
        throw new Error('CHECKPOINT_STORE_UNAVAILABLE');
      },
      upsert: async () => {
        throw new Error('CHECKPOINT_STORE_UNAVAILABLE');
      },
    },
    fallbackConversations,
    clock,
  );
  const fallbackContext = new ContextService(
    fallbackConversations,
    new RecallService(new EmptyRecallRepository(), clock),
    new SkillRegistry(),
    emptyModelContinuations,
    null!,
    failingCheckpoints,
  );
  const fallbackPlan = await fallbackContext.compose({
    scope,
    threadId: 'scenario-thread',
    runId: 'scenario-run',
    currentInput: 'Proceed despite a checkpoint persistence failure.',
    goal: 'GOAL_MARKER: preserve parser correctness and generated-file immutability.',
    taskPlan: 'PLAN_MARKER: inspect, patch source only, run deterministic verification.',
    collaborationContext: 'COLLAB_MARKER: child parser audit completed; no active child work remains.',
    modelContextWindow: 4_096,
    maxContextTokens: 1_050,
    reservedOutputTokens: 256,
    maxRecallItems: 5,
    maxRecallBytes: 8_192,
    compactionMode: 'balanced',
    tools: [],
  });
  assert.equal(fallbackPlan.compacted, true);
  assert.equal(
    fallbackPlan.tokenDiagnostics.summaryCheckpointTokens,
    0,
    'checkpoint failure must fall back to drop-only projection instead of fabricating derived state',
  );
  assert.ok(
    fallbackPlan.droppedSections.includes('summary-checkpoint:unavailable'),
    'checkpoint failure must be observable without blocking model execution',
  );
  assertValidToolExchange(fallbackPlan.messages);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-context-checkpoint-schema-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'context-checkpoint.sqlite', nodeEnv: 'test' });
  try {
    await db.initialize();
    const checkpointTable = await db.queryOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_context_checkpoints'",
    );
    assert.equal(
      checkpointTable?.name,
      'ai_context_checkpoints',
      'fresh schema must expose the single Context checkpoint owner',
    );
    const legacyDigest = await db.queryOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_context_digests'",
    );
    assert.equal(legacyDigest, null, 'legacy ai_context_digests dead owner must be removed');

    await db.execute(
      "INSERT INTO users (id, username, hashed_password) VALUES (1, 'context-checkpoint-user', 'not-used')",
    );
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, 'scenario-app', '1.0.0', 'enabled', 'running', 0, ?, ?)`,
      [clock.nowUnixSeconds(), clock.nowUnixSeconds()],
    );
    const durableConversationsRepository = new SqliteConversationRepository(db);
    await durableConversationsRepository.createThread(
      scope,
      'context-checkpoint-thread',
      'Context checkpoint fixture',
      'manual',
      clock.nowUnixSeconds(),
    );
    await durableConversationsRepository.appendEntry(scope, 'context-checkpoint-thread', {
      id: 'context-checkpoint-entry-1',
      kind: 'user_input',
      payload: { text: 'Keep the durable constraint marker.' },
      createdAt: clock.nowUnixSeconds(),
    });
    await durableConversationsRepository.appendEntry(scope, 'context-checkpoint-thread', {
      id: 'context-checkpoint-entry-2',
      kind: 'assistant_message',
      payload: { text: 'FAILED ATTEMPT STALE_SOURCE_MARKER: remove this source and never reuse its derived summary.' },
      createdAt: clock.nowUnixSeconds() + 1,
    });
    await durableConversationsRepository.appendEntry(scope, 'context-checkpoint-thread', {
      id: 'context-checkpoint-entry-3',
      kind: 'assistant_message',
      payload: { text: 'Current state remains safe and resumable.' },
      createdAt: clock.nowUnixSeconds() + 2,
    });
    const durableConversations = new ConversationService(durableConversationsRepository, clock, null!, null!);
    const durableCheckpointRepository = new SqliteContextCheckpointRepository(db);
    const durableCheckpoints = new ContextCheckpointService(durableCheckpointRepository, durableConversations, clock);
    const firstCheckpoint = await durableCheckpoints.checkpointForPrefix({
      scope,
      threadId: 'context-checkpoint-thread',
      throughSequence: 3,
      maxSummaryTokens: 512,
      hardPressure: true,
    });
    assert.ok(firstCheckpoint, 'Context checkpoint producer must persist a derived summary');
    assert.match(firstCheckpoint!.content, /STALE_SOURCE_MARKER/);
    const reusedCheckpoint = await durableCheckpoints.checkpointForPrefix({
      scope,
      threadId: 'context-checkpoint-thread',
      throughSequence: 3,
      maxSummaryTokens: 512,
      hardPressure: true,
    });
    assert.equal(
      reusedCheckpoint?.id,
      firstCheckpoint!.id,
      'unchanged canonical source must reuse the durable checkpoint',
    );
    const persistedCount = await db.queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM ai_context_checkpoints WHERE thread_id = 'context-checkpoint-thread'",
    );
    assert.equal(
      persistedCount?.count,
      1,
      'checkpoint producer/consumer must round-trip through the single durable table',
    );

    await db.execute("DELETE FROM ai_thread_entries WHERE id = 'context-checkpoint-entry-2'");
    const refreshedCheckpoint = await durableCheckpoints.checkpointForPrefix({
      scope,
      threadId: 'context-checkpoint-thread',
      throughSequence: 3,
      maxSummaryTokens: 512,
      hardPressure: true,
    });
    assert.ok(refreshedCheckpoint);
    assert.notEqual(
      refreshedCheckpoint!.sourceHash,
      firstCheckpoint!.sourceHash,
      'source hash mismatch must invalidate stale derived Context state',
    );
    assert.doesNotMatch(
      refreshedCheckpoint!.content,
      /STALE_SOURCE_MARKER/,
      'regenerated checkpoint must derive only from the current canonical Ledger source',
    );
    const resumedBoundaryCheckpoint = await durableCheckpoints.checkpointForPrefix({
      scope,
      threadId: 'context-checkpoint-thread',
      runId: 'resumed-run',
      historyBoundary: { baseThrough: 3, runThrough: {} },
      throughSequence: 3,
      maxSummaryTokens: 512,
      hardPressure: true,
    });
    assert.ok(resumedBoundaryCheckpoint);
    assert.equal(
      resumedBoundaryCheckpoint!.visibility.kind,
      'run_boundary',
      'checkpoint resume visibility must remain explicit durable metadata',
    );
    assert.notEqual(
      resumedBoundaryCheckpoint!.id,
      refreshedCheckpoint!.id,
      'a resumed Run boundary must not reuse a Thread-prefix checkpoint under a different visibility contract',
    );
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }

  const upgradeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-context-checkpoint-upgrade-'));
  const legacyDb = new DatabaseSync(path.join(upgradeDirectory, 'context-checkpoint-upgrade.sqlite'));
  try {
    legacyDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO migrations (id, name, applied_at) VALUES (29, 'legacy baseline', 1800000000);
      CREATE TABLE ai_threads (id TEXT PRIMARY KEY);
      CREATE TABLE ai_context_digests (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
        from_sequence INTEGER NOT NULL,
        to_sequence INTEGER NOT NULL CHECK(to_sequence >= from_sequence),
        source_hash TEXT NOT NULL,
        model_config_version TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    await runMigrations(legacyDb);
    const upgradedCheckpoint = legacyDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_context_checkpoints'")
      .get() as { name?: string } | undefined;
    const upgradedLegacyDigest = legacyDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_context_digests'")
      .get() as { name?: string } | undefined;
    const migrationVersion = legacyDb.prepare('SELECT MAX(id) AS version FROM migrations').get() as
      { version?: number } | undefined;
    assert.equal(
      upgradedCheckpoint?.name,
      'ai_context_checkpoints',
      'migration 30 must create the Context checkpoint owner',
    );
    assert.equal(upgradedLegacyDigest, undefined, 'migration 30 must drop the dead ai_context_digests table');
    assert.equal(migrationVersion?.version, 46, 'legacy databases must advance through migration 46');
  } finally {
    legacyDb.close();
    fs.rmSync(upgradeDirectory, { recursive: true, force: true });
  }

  return [
    { name: 'summary_checkpoint_tokens', value: plan.tokenDiagnostics.summaryCheckpointTokens, unit: 'tokens' },
    { name: 'visible_context_messages', value: plan.messages.length, unit: 'messages' },
    { name: 'checkpoint_failure_fallbacks', value: 1, unit: 'cases' },
    { name: 'durable_checkpoint_roundtrips', value: 1, unit: 'cases' },
    { name: 'stale_source_regenerations', value: 1, unit: 'cases' },
    { name: 'upgrade_migration_cases', value: 1, unit: 'cases' },
    { name: 'legacy_digest_tables', value: 0, unit: 'tables' },
    { name: 'migration_version', value: 46, unit: 'version' },
  ];
};
