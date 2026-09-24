import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunnerJournal } from '../../packages/agent-runner/src/controller/journal';

const command = (id: string, status: 'pending' | 'running' | 'unknown', timestamp: number) => ({
  commandId: id,
  payloadHash: 'a'.repeat(64),
  status,
  action: 'packInstall',
  workspaceId: null,
  result: null,
  error: status === 'unknown' ? 'controller_restarted_during_command' : null,
  createdAt: timestamp,
  completedAt: status === 'unknown' ? timestamp : null,
});

const job = (id: string, status: 'pending' | 'running' | 'unknown', timestamp: number) => ({
  jobId: id,
  payloadHash: 'b'.repeat(64),
  workspaceId: 'workspace-1',
  generation: 1,
  status,
  result: null,
  error: status === 'unknown' ? 'controller_restarted_during_job' : null,
  createdAt: timestamp,
  completedAt: status === 'unknown' ? timestamp : null,
});

const writeState = (
  file: string,
  commands: Record<string, ReturnType<typeof command>>,
  jobs: Record<string, ReturnType<typeof job>>,
): void => {
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 4,
      commands,
      workspaces: {},
      jobs,
    }),
  );
};

const main = (): void => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-runner-journal-retention-'));
  try {
    const recoveryFile = path.join(root, 'recovery.json');
    const commands: Record<string, ReturnType<typeof command>> = {};
    const jobs: Record<string, ReturnType<typeof job>> = {};
    for (let index = 0; index < 16_500; index += 1) {
      const commandId = `command-${index.toString().padStart(5, '0')}`;
      const jobId = `job-${index.toString().padStart(5, '0')}`;
      commands[commandId] = command(commandId, 'unknown', index + 1);
      jobs[jobId] = job(jobId, 'unknown', index + 1);
    }
    commands['command-active'] = command('command-active', 'running', 20_000);
    jobs['job-active'] = job('job-active', 'running', 20_000);
    writeState(recoveryFile, commands, jobs);

    const recovered = new RunnerJournal(recoveryFile);
    assert(recovered.command('command-active'), 'active command must survive emergency compaction');
    assert(recovered.job('job-active'), 'active job must survive emergency compaction');
    assert.equal(recovered.command('command-00000'), null, 'oldest unknown command evidence should be pruned first');
    assert.equal(recovered.job('job-00000'), null, 'oldest unknown job evidence should be pruned first');
    assert(recovered.command('command-16499'), 'recent unknown command evidence must be retained');
    assert(recovered.job('job-16499'), 'recent unknown job evidence must be retained');
    assert(recovered.commands().length <= 12_288);
    assert(recovered.jobs().length <= 12_288);

    const persisted = JSON.parse(fs.readFileSync(recoveryFile, 'utf8')) as {
      commands: Record<string, unknown>;
      jobs: Record<string, unknown>;
    };
    assert(Object.keys(persisted.commands).length <= 12_288);
    assert(Object.keys(persisted.jobs).length <= 12_288);

    const capacityFile = path.join(root, 'capacity.json');
    const activeCommands: Record<string, ReturnType<typeof command>> = {};
    for (let index = 0; index < 16_384; index += 1) {
      const id = `pending-${index.toString().padStart(5, '0')}`;
      activeCommands[id] = command(id, 'pending', index + 1);
    }
    writeState(capacityFile, activeCommands, {});
    const saturated = new RunnerJournal(capacityFile);
    assert.throws(
      () => saturated.begin('pending-overflow', 'c'.repeat(64), 'cacheCleanup', null),
      /RUNNER_JOURNAL_CAPACITY_EXCEEDED/,
      'journal must reject growth rather than persist a collection that the next startup cannot decode',
    );
    const after = JSON.parse(fs.readFileSync(capacityFile, 'utf8')) as { commands: Record<string, unknown> };
    assert.equal(Object.keys(after.commands).length, 16_384);

    process.stdout.write('runner journal unknown retention regression: PASS\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

main();
