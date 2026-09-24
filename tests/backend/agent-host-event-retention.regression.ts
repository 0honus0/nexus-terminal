import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type WebSocket from 'ws';
import {
  appendHostEvent,
  HOST_EVENT_RETENTION_LIMIT,
} from '../../packages/backend/src/infrastructure/agent/events/host-event-outbox';
import { SqliteRunRepository } from '../../packages/backend/src/infrastructure/agent/repositories/sqlite-run.repository';
import { DatabaseAdapter } from '../../packages/backend/src/infrastructure/database/database.adapter';
import { definedMigrations } from '../../packages/backend/src/infrastructure/database/sqlite-migrations';
import { AgentProtocolSession } from '../../packages/backend/src/interfaces/websocket/agent-protocol.session';
import type { AgentEventFacade, AgentRunFacade } from '../../packages/backend/src/modules/agent/public';

const verifyLegacyMigration = async (root: string): Promise<void> => {
  const legacy = new DatabaseSync(path.join(root, 'legacy.sqlite'));
  try {
    legacy.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      INSERT INTO users (id) VALUES (1);
      CREATE TABLE agent_host_cursors (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        next_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_sequence >= 1)
      );
      CREATE TABLE agent_host_events (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK(sequence >= 1),
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
        occurred_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, sequence)
      );
      INSERT INTO agent_host_cursors (user_id, next_sequence)
      VALUES (1, ${HOST_EVENT_RETENTION_LIMIT + 174});
    `);
    const insert = legacy.prepare(
      'INSERT INTO agent_host_events (user_id, sequence, type, payload_json, occurred_at) VALUES (1, ?, ?, ?, ?)',
    );
    for (let sequence = 1; sequence <= HOST_EVENT_RETENTION_LIMIT + 173; sequence += 1) {
      insert.run(sequence, 'summary.changed', '{}', sequence);
    }
    const migration = definedMigrations.find((candidate) => candidate.id === 47);
    assert(migration, 'retention migration #47 must exist');
    assert.equal(await migration.check?.(legacy), true);
    legacy.exec(migration.sql);
    const cursor = legacy
      .prepare('SELECT next_sequence, oldest_cursor FROM agent_host_cursors WHERE user_id=1')
      .get() as { next_sequence: number; oldest_cursor: number };
    const retained = legacy
      .prepare('SELECT COUNT(*) AS count, MIN(sequence) AS min_sequence FROM agent_host_events')
      .get() as {
      count: number;
      min_sequence: number;
    };
    assert.equal(cursor.oldest_cursor, 173);
    assert.equal(retained.count, HOST_EVENT_RETENTION_LIMIT);
    assert.equal(retained.min_sequence, 174);
  } finally {
    legacy.close();
  }
};

const main = async (): Promise<void> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-host-event-retention-'));
  const db = new DatabaseAdapter({ dataDirectory: root, filename: 'retention.sqlite', nodeEnv: 'test' });
  try {
    await verifyLegacyMigration(root);
    await db.initialize();
    await db.execute("INSERT INTO users (id, username, hashed_password) VALUES (1, 'retention-user', 'not-used')");
    const total = HOST_EVENT_RETENTION_LIMIT + 173;
    await db.transaction(async (tx) => {
      for (let index = 1; index <= total; index += 1) {
        await appendHostEvent(tx, 1, 'summary.changed', { index }, index);
      }
    });

    const repository = new SqliteRunRepository(db);
    const window = await repository.hostCursorWindow(1);
    assert.equal(window.highWater, total);
    assert.equal(window.oldestAvailableCursor, total - HOST_EVENT_RETENTION_LIMIT);

    const row = await db.queryOne<{ count: number; min_sequence: number; max_sequence: number }>(
      `SELECT COUNT(*) AS count, MIN(sequence) AS min_sequence, MAX(sequence) AS max_sequence
       FROM agent_host_events WHERE user_id=1`,
    );
    assert.equal(row?.count, HOST_EVENT_RETENTION_LIMIT, 'Host durable delta rows must remain bounded');
    assert.equal(row?.min_sequence, window.oldestAvailableCursor + 1);
    assert.equal(row?.max_sequence, total);

    await assert.rejects(repository.readHostEvents(1, window.oldestAvailableCursor - 1, 100), /CURSOR_EXPIRED/);
    const firstRetainedPage = await repository.readHostEvents(1, window.oldestAvailableCursor, 100);
    assert.equal(firstRetainedPage[0]?.sequence, window.oldestAvailableCursor + 1);
    assert.equal((await repository.readHostEvents(1, total, 100)).length, 0);

    const wire: Array<Record<string, unknown>> = [];
    const socket = {
      readyState: 1,
      bufferedAmount: 0,
      send: (value: string) => wire.push(JSON.parse(value) as Record<string, unknown>),
      close: () => undefined,
    } as unknown as WebSocket;
    const events = {
      readRun: async () => [],
      readHost: (userId: number, after: number, limit: number) => repository.readHostEvents(userId, after, limit),
      hostCursor: (userId: number) => repository.hostCursor(userId),
      hostCursorWindow: (userId: number) => repository.hostCursorWindow(userId),
      onRunWake: () => () => undefined,
      onHostWake: () => () => undefined,
      onTransient: () => () => undefined,
    } satisfies AgentEventFacade;
    const session = new AgentProtocolSession(socket, { userId: 1 }, { events, runs: {} as AgentRunFacade });
    await session.handleMessage(
      Buffer.from(
        JSON.stringify({
          type: 'subscribe',
          requestId: 'stale-request',
          payload: {
            subscriptionId: 'stale-host',
            channel: 'host',
            cursor: window.oldestAvailableCursor - 1,
          },
        }),
      ),
      false,
    );
    assert.deepEqual(wire[0], {
      type: 'error',
      requestId: 'stale-request',
      payload: { code: 'CURSOR_EXPIRED' },
    });
    assert.equal(session.subscriptionCount(), 0);
    await session.close();

    const frontendSource = fs.readFileSync(
      new URL('../../packages/frontend/src/features/agent/api/agent-events.ts', import.meta.url),
      'utf8',
    );
    assert(frontendSource.includes("cause.message === 'CURSOR_EXPIRED'"));
    assert(frontendSource.includes("agentHttpClient.get<AgentEnvelopeDto<AgentHostSummaryDto>>('/agent/summary')"));
    assert(frontendSource.includes('cursor = await hostResyncCursor()'));
    assert(frontendSource.includes("yield { type: 'transport.disconnected', payload: null }"));

    process.stdout.write('agent host event retention regression: PASS\n');
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
