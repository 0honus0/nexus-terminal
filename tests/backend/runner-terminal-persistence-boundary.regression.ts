import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunnerJournal } from '../../packages/agent-runner/src/controller/journal';
import { RunnerControllerServer } from '../../packages/agent-runner/src/controller/server';

const withOneRenameFailure = (journalFile: string, action: () => void): void => {
  const original = fs.renameSync;
  let failed = false;
  (fs as unknown as { renameSync: typeof fs.renameSync }).renameSync = ((source, target) => {
    if (!failed && String(source) === `${journalFile}.tmp` && String(target) === journalFile) {
      failed = true;
      throw new Error('simulated transient rename failure');
    }
    return original(source, target);
  }) as typeof fs.renameSync;
  try {
    action();
  } finally {
    (fs as unknown as { renameSync: typeof fs.renameSync }).renameSync = original;
  }
  assert.equal(failed, true, 'fault injection must hit the terminal journal rename');
};

const main = async (): Promise<void> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-terminal-persistence-boundary-'));
  try {
    const journalFile = path.join(directory, 'journal.json');
    const journal = new RunnerJournal(journalFile);
    journal.begin('command-cow', 'hash-command', 'packInstall', null);
    journal.running('command-cow');

    assert.throws(
      () =>
        withOneRenameFailure(journalFile, () => {
          journal.succeed('command-cow', { installed: 1 });
        }),
      /simulated transient rename failure/,
    );
    assert.equal(
      journal.command('command-cow')?.status,
      'running',
      'failed terminal flush must not advance the in-memory command beyond the durable state',
    );
    assert.equal(new RunnerJournal(journalFile).command('command-cow')?.status, 'running');

    journal.unknown('command-cow', 'RUNNER_TERMINAL_PERSISTENCE_FAILED');
    assert.equal(new RunnerJournal(journalFile).command('command-cow')?.status, 'unknown');

    journal.beginJob('job-cow', 'hash-job', 'workspace-cow', 1);
    journal.runningJob('job-cow');
    assert.throws(
      () =>
        withOneRenameFailure(journalFile, () => {
          journal.succeedJob('job-cow', {
            exitCode: 0,
            signal: null,
            stdout: 'ok',
            stderr: '',
            truncated: false,
            timedOut: false,
          });
        }),
      /simulated transient rename failure/,
    );
    assert.equal(journal.job('job-cow')?.status, 'running');
    assert.equal(new RunnerJournal(journalFile).job('job-cow')?.status, 'running');

    const commandEvents: string[] = [];
    const commandServer = new RunnerControllerServer({
      journal: {
        succeed: () => {
          throw new Error('simulated success persistence failure');
        },
        unknown: () => commandEvents.push('unknown'),
        fail: () => commandEvents.push('failed'),
      },
      cleanup: { cacheCleanup: async () => ({ cleared: true }) },
    } as never);
    await (
      commandServer as unknown as {
        executeAdminCommand(command: Record<string, unknown>, action: 'cacheCleanup'): Promise<void>;
      }
    ).executeAdminCommand({ commandId: 'command-admin' }, 'cacheCleanup');
    assert.deepEqual(
      commandEvents,
      ['unknown'],
      'a completed admin side effect with failed success persistence must become unknown, never failed',
    );

    const jobEvents: string[] = [];
    const jobServer = new RunnerControllerServer({
      runtimeEngine: {
        executeJob: async () => ({
          exitCode: 0,
          signal: null,
          stdout: 'done',
          stderr: '',
          truncated: false,
          timedOut: false,
        }),
      },
      journal: {
        succeedJob: () => {
          throw new Error('simulated Job success persistence failure');
        },
        unknownJob: () => jobEvents.push('unknown'),
        failJob: () => jobEvents.push('failed'),
      },
    } as never);
    await (
      jobServer as unknown as {
        executeWorkspaceJob(request: {
          jobId: string;
          workspaceId: string;
          generation: number;
          deadlineAt: number;
          argv: string[];
          cwd: string;
          maxBytes: number;
          timeoutMs: number;
        }): Promise<void>;
      }
    ).executeWorkspaceJob({
      jobId: 'job-server',
      workspaceId: 'workspace-cow',
      generation: 1,
      deadlineAt: 10,
      argv: ['true'],
      cwd: '/workspace/work',
      maxBytes: 1024,
      timeoutMs: 1000,
    });
    assert.deepEqual(
      jobEvents,
      ['unknown'],
      'a completed Job must not be rewritten as failed when succeedJob persistence fails',
    );

    const serverSource = fs.readFileSync(
      new URL('../../packages/agent-runner/src/controller/server.ts', import.meta.url),
      'utf8',
    );
    assert.equal(
      (serverSource.match(/void this\.execute(?:WorkspaceJob|WorkspaceCommand|AdminCommand)\([^;]+?\.catch\(/gs) ?? [])
        .length,
      3,
    );

    process.stdout.write('Runner terminal persistence boundary regression: PASS\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
