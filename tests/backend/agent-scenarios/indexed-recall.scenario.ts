import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteConversationRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-conversation.repository';
import { SqliteRecallRepository } from '../../../packages/backend/src/infrastructure/agent/repositories/sqlite-recall.repository';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { ContextService } from '../../../packages/backend/src/modules/agent/ai/context.service';
import { ConversationService } from '../../../packages/backend/src/modules/agent/ai/conversation.service';
import { RecallService } from '../../../packages/backend/src/modules/agent/ai/recall.service';
import { SkillRegistry } from '../../../packages/backend/src/modules/agent/ai/skill-registry';
import { emptyModelContinuations } from './scenario-fixtures';
import { EmptyRecallRepository } from './scenario-context-helpers';

export const indexedRecallScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agent-indexed-recall-'));
  const databasePath = path.join(directory, 'indexed-recall.sqlite');
  let db: DatabaseAdapter | null = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'indexed-recall.sqlite',
    nodeEnv: 'test',
  });
  const indexedScope: Scope = { userId: 1, appId: 'indexed-recall-app' };
  const threadId = 'indexed-recall-thread';
  const now = 1_800_950_000;

  try {
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'indexed-recall-user', 'not-used')");
    await db.execute(
      `INSERT INTO agent_apps
        (user_id, app_id, active_version, desired_state, observed_state, running_count, created_at, updated_at)
       VALUES (1, ?, '1.0.0', 'enabled', 'running', 1, ?, ?)`,
      [indexedScope.appId, now, now],
    );
    await db.execute(
      `INSERT INTO ai_threads
        (id, user_id, app_id, title, title_source, next_sequence, created_at, updated_at)
       VALUES (?, 1, ?, 'Indexed recall', 'manual', 1001, ?, ?)`,
      [threadId, indexedScope.appId, now, now],
    );

    await db.execute(
      `WITH RECURSIVE seq(x) AS (
         SELECT 1
         UNION ALL
         SELECT x + 1 FROM seq WHERE x < 1200
       )
       INSERT INTO ai_memories
         (id, user_id, app_id, content, source_refs_json, confidence, status, created_at, updated_at)
       SELECT printf('memory-filler-%04d', x), 1, ?, 'irrelevant memory filler ' || x, '[]', 0.5, 'published', ?, ?
       FROM seq`,
      [indexedScope.appId, now - 1, now - 1],
    );
    await db.execute(
      `INSERT INTO ai_memories
        (id, user_id, app_id, content, source_refs_json, confidence, status, created_at, updated_at)
       VALUES
        ('memory-english-target', 1, ?, 'Keep ContinuationNeedleID as the durable continuation authority.', '[]', 0.9, 'published', ?, ?),
        ('memory-cjk-target', 1, ?, '项目约束：索引必须支持两个汉字的查询。', '[]', 0.9, 'published', ?, ?)`,
      [indexedScope.appId, now - 10_000, now - 10_000, indexedScope.appId, now - 10_000, now - 10_000],
    );

    await db.execute(
      `WITH RECURSIVE seq(x) AS (
         SELECT 1
         UNION ALL
         SELECT x + 1 FROM seq WHERE x < 1000
       )
       INSERT INTO ai_thread_entries
         (id, thread_id, user_id, app_id, sequence, kind, payload_json, created_at)
       SELECT printf('entry-%04d', x), ?, 1, ?, x, 'user_input',
              json_object('text', 'historical filler ' || x), ?
       FROM seq`,
      [threadId, indexedScope.appId, now],
    );
    await db.execute(
      `UPDATE ai_thread_entries
       SET payload_json = json_object('text', 'Earlier decision: keep ContinuationNeedleID authority in durable state.')
       WHERE thread_id = ? AND sequence = 20`,
      [threadId],
    );
    await db.execute(
      `UPDATE ai_thread_entries
       SET payload_json = json_object('text', '项目历史约束：短中文检索必须命中索引。')
       WHERE thread_id = ? AND sequence = 21`,
      [threadId],
    );

    const indexedClock: ClockPort = { nowUnixSeconds: () => now };
    const recall = new RecallService(new SqliteRecallRepository(db), indexedClock);
    const englishMemory = await recall.recall(indexedScope, 'ContinuationNeedleID', 5, 8_192);
    assert.equal(
      englishMemory[0]?.id,
      'memory-english-target',
      'indexed Memory recall must find a target older than the former 1000-row recency scan',
    );
    const cjkMemory = await recall.recall(indexedScope, '项目', 5, 8_192);
    assert.equal(cjkMemory[0]?.id, 'memory-cjk-target', 'two-character CJK Memory query must use indexed retrieval');

    const conversationRepository = new SqliteConversationRepository(db);
    const conversations = new ConversationService(conversationRepository, indexedClock, null!, null!);
    const context = new ContextService(
      conversations,
      new RecallService(new EmptyRecallRepository(), indexedClock),
      new SkillRegistry(),
      emptyModelContinuations,
      null!,
    );

    const englishContext = await context.compose({
      scope: indexedScope,
      threadId,
      currentInput: 'ContinuationNeedleID',
      modelContextWindow: 32_768,
      maxContextTokens: 32_768,
      reservedOutputTokens: 1_024,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      tools: [],
    });
    assert.ok(
      englishContext.sourceRanges.some((source) => source.kind === 'thread_recall' && source.id === 'entry-0020'),
      'Earlier-thread indexed retrieval must find an entry outside the former 800-row scan',
    );

    const cjkContext = await context.compose({
      scope: indexedScope,
      threadId,
      currentInput: '项目',
      modelContextWindow: 32_768,
      maxContextTokens: 32_768,
      reservedOutputTokens: 1_024,
      maxRecallItems: 5,
      maxRecallBytes: 8_192,
      tools: [],
    });
    assert.ok(
      cjkContext.sourceRanges.some((source) => source.kind === 'thread_recall' && source.id === 'entry-0021'),
      'two-character CJK Earlier-thread query must use indexed retrieval',
    );

    const boundedMemoryCandidates = await new SqliteRecallRepository(db).searchPublishedCandidates(
      indexedScope,
      now,
      ['ContinuationNeedleID'],
      24,
    );
    assert.ok(boundedMemoryCandidates.length <= 24, 'Memory first-stage retrieval must obey its candidate bound');
    const boundedThreadCandidates = await conversationRepository.searchEarlierEntries(
      indexedScope,
      threadId,
      ['ContinuationNeedleID'],
      841,
      64,
    );
    assert.ok(
      boundedThreadCandidates.length <= 64,
      'Earlier-thread first-stage retrieval must obey its candidate bound',
    );

    await db.close();
    db = null;

    const raw = new DatabaseSync(databasePath);
    try {
      raw.exec('DROP TABLE ai_memories_search; DROP TABLE ai_thread_entries_search;');
    } finally {
      raw.close();
    }

    db = new DatabaseAdapter({ dataDirectory: directory, filename: 'indexed-recall.sqlite', nodeEnv: 'test' });
    await db.initialize();
    const repairedRecall = await new RecallService(new SqliteRecallRepository(db), indexedClock).recall(
      indexedScope,
      '项目',
      5,
      8_192,
    );
    assert.equal(
      repairedRecall[0]?.id,
      'memory-cjk-target',
      'missing derived FTS tables must rebuild from canonical Memory/Ledger rows on startup',
    );
    const repairedThread = await new SqliteConversationRepository(db).searchEarlierEntries(
      indexedScope,
      threadId,
      ['项目'],
      841,
      64,
    );
    assert.ok(
      repairedThread.some((entry) => entry.id === 'entry-0021'),
      'rebuilt Earlier-thread index must recover canonical CJK history',
    );

    return [
      { name: 'memory_rows_beyond_old_scan_found', value: 2, unit: 'queries' },
      { name: 'thread_rows_beyond_old_scan_found', value: 2, unit: 'queries' },
      { name: 'max_memory_candidate_rows', value: boundedMemoryCandidates.length, unit: 'rows' },
      { name: 'max_thread_candidate_rows', value: boundedThreadCandidates.length, unit: 'rows' },
      { name: 'two_character_cjk_indexed_queries', value: 2, unit: 'queries' },
      { name: 'derived_indexes_rebuilt', value: 2, unit: 'indexes' },
    ];
  } finally {
    await db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
