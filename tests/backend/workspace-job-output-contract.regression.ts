import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunnerJournal } from '../../packages/agent-runner/src/controller/journal';
import { decodeWorkspaceJobView } from '../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http-protocol';

const result = (stdout: string, stderr = '') => ({
  exitCode: 0,
  signal: null,
  stdout,
  stderr,
  truncated: false,
  timedOut: false,
});

const wire = (jobId: string, stdout: string, stderr = '') => ({
  jobId,
  workspaceId: 'workspace-job-output',
  generation: 1,
  status: 'succeeded',
  result: result(stdout, stderr),
  error: null,
  createdAt: 1,
  completedAt: 2,
});

const main = (): void => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-job-output-contract-'));
  try {
    const journalFile = path.join(root, 'journal.json');
    let journal = new RunnerJournal(journalFile);

    for (const [label, bytes] of [
      ['32k', 32 * 1024],
      ['128k', 128 * 1024],
      ['1m', 1024 * 1024],
    ] as const) {
      const jobId = `job-${label}`;
      journal.beginJob(jobId, label.repeat(8), 'workspace-job-output', 1);
      journal.runningJob(jobId);
      const stdout = 'x'.repeat(bytes);
      journal.succeedJob(jobId, result(stdout));

      const decoded = decodeWorkspaceJobView(wire(jobId, stdout));
      assert.equal(decoded.result?.stdout.length, bytes, `${label} Backend decoder must accept legal Job output`);

      journal = new RunnerJournal(journalFile);
      assert.equal(
        journal.job(jobId)?.result?.stdout.length,
        bytes,
        `${label} persisted Job output must survive Runner restart`,
      );
    }

    const overflowId = 'job-overflow';
    journal.beginJob(overflowId, 'overflow'.repeat(8), 'workspace-job-output', 1);
    journal.runningJob(overflowId);
    assert.throws(
      () => journal.succeedJob(overflowId, result('x'.repeat(1024 * 1024), 'y')),
      /JOB_OUTPUT_LIMIT_INVALID/,
      'writer must reject output beyond the durable decoder contract before persisting it',
    );
    assert.equal(journal.job(overflowId)?.status, 'running');

    assert.throws(
      () => decodeWorkspaceJobView(wire('job-wire-overflow', 'x'.repeat(1024 * 1024 + 1))),
      /WORKSPACE_RUNTIME_PROTOCOL_INVALID/,
    );

    const adapterSource = fs.readFileSync(
      new URL(
        '../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http.adapter.ts',
        import.meta.url,
      ),
      'utf8',
    );
    assert(adapterSource.includes('const MAX_JOB_RESPONSE_BYTES = 2 * 1024 * 1024;'));
    assert(
      (adapterSource.match(/maxResponseBytes: MAX_JOB_RESPONSE_BYTES/g) ?? []).length >= 4,
      'all Job start/query/wait/cancel response paths must use the larger Job JSON envelope',
    );

    process.stdout.write('workspace Job output contract regression: PASS\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

main();
