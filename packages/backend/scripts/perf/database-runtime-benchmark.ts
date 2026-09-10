import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseAdapter } from '../../src/infrastructure/database/database.adapter';
import { logger, setBackendLogLevel } from '../../src/shared/logging/logger';
import { runtimePerformanceMetrics } from '../../src/shared/observability/runtime-performance';

const RUNS = Number.parseInt(process.env.NEXUS_PERF_RUNS ?? '5', 10);
const OPERATIONS = Number.parseInt(process.env.NEXUS_PERF_DB_OPERATIONS ?? '48', 10);
const CONCURRENCY = Number.parseInt(process.env.NEXUS_PERF_DB_CONCURRENCY ?? '8', 10);
const RECURSION = Number.parseInt(process.env.NEXUS_PERF_DB_RECURSION ?? '120000', 10);
const HEARTBEAT_MS = 5;

const QUERY = `
WITH RECURSIVE counter(value) AS (
  SELECT 1
  UNION ALL
  SELECT value + 1 FROM counter WHERE value < ?
)
SELECT SUM((value * 17) % 101) AS total FROM counter
`;

interface HeartbeatResult {
  stop(): { ticks: number; maxDelayMs: number };
}

const startHeartbeat = (): HeartbeatResult => {
  let expectedAt = performance.now() + HEARTBEAT_MS;
  let ticks = 0;
  let maxDelayMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxDelayMs = Math.max(maxDelayMs, Math.max(0, now - expectedAt));
    ticks += 1;
    expectedAt = now + HEARTBEAT_MS;
  }, HEARTBEAT_MS);
  return {
    stop: () => {
      clearInterval(timer);
      return { ticks, maxDelayMs: Number(maxDelayMs.toFixed(3)) };
    },
  };
};

const runOnce = async (database: DatabaseAdapter, run: number): Promise<void> => {
  runtimePerformanceMetrics.resetInterval();
  await delay(50);
  const heartbeat = startHeartbeat();
  const startedAt = performance.now();
  let nextOperation = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const operation = nextOperation++;
        if (operation >= OPERATIONS) return;
        const row = await database.queryOne<{ total: number }>(QUERY, [RECURSION]);
        if (!row || !Number.isFinite(Number(row.total))) throw new Error('Benchmark query returned an invalid result.');
      }
    }),
  );

  const durationMs = performance.now() - startedAt;
  await delay(100);
  const heartbeatResult = heartbeat.stop();
  const runtime = runtimePerformanceMetrics.snapshotAndReset();
  logger.debug(
    {
      metric: 'benchmark.database-runtime',
      run,
      operations: OPERATIONS,
      concurrency: CONCURRENCY,
      recursion: RECURSION,
      durationMs: Number(durationMs.toFixed(3)),
      operationsPerSecond: Number(((OPERATIONS * 1000) / durationMs).toFixed(2)),
      heartbeat: heartbeatResult,
      runtime,
    },
    'Database runtime benchmark',
  );
};

const main = async (): Promise<void> => {
  if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error('NEXUS_PERF_RUNS must be a positive integer.');
  if (!Number.isInteger(OPERATIONS) || OPERATIONS < 1) throw new Error('NEXUS_PERF_DB_OPERATIONS must be positive.');
  if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) throw new Error('NEXUS_PERF_DB_CONCURRENCY must be positive.');
  if (!Number.isInteger(RECURSION) || RECURSION < 1000) throw new Error('NEXUS_PERF_DB_RECURSION must be >= 1000.');

  setBackendLogLevel('debug');
  runtimePerformanceMetrics.start();
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-db-perf-'));
  const database = new DatabaseAdapter({ dataDirectory, filename: 'benchmark.db', nodeEnv: 'benchmark' });
  try {
    await database.initialize();
    for (let run = 1; run <= RUNS; run += 1) await runOnce(database, run);
  } finally {
    await database.close().catch(() => undefined);
    runtimePerformanceMetrics.stop();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  logger.fatal({ err: error }, 'Database runtime benchmark failed');
  process.exitCode = 1;
});
