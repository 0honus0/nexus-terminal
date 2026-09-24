import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoverWorkspaceCheckpointRestore } from '../../packages/agent-runner/src/controller/workspace-checkpoint-archive';

const root = new URL('../../', import.meta.url);
const read = (relativePath: string): string => fs.readFileSync(new URL(relativePath, root), 'utf8');

const writeTransaction = (scratchRoot: string, token: string, phase: 'prepared' | 'backup-moved'): void => {
  fs.mkdirSync(scratchRoot, { recursive: true });
  fs.writeFileSync(path.join(scratchRoot, 'restore-transaction.json'), JSON.stringify({ version: 1, token, phase }));
};

const main = (): void => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-checkpoint-restore-recovery-'));
  try {
    const workRoot = path.join(directory, 'core', 'workspace', 'work');
    const scratchRoot = path.join(directory, '.control', 'checkpoints');
    fs.mkdirSync(workRoot, { recursive: true });
    fs.writeFileSync(path.join(workRoot, 'state.txt'), 'old');

    const tokenA = '11111111-1111-4111-8111-111111111111';
    const backupA = path.join(scratchRoot, `work-backup-${tokenA}`);
    const stagingA = path.join(scratchRoot, `restore-${tokenA}`);
    fs.mkdirSync(stagingA, { recursive: true });
    fs.writeFileSync(path.join(stagingA, 'state.txt'), 'new');
    fs.renameSync(workRoot, backupA);
    writeTransaction(scratchRoot, tokenA, 'prepared');

    assert.equal(recoverWorkspaceCheckpointRestore(workRoot, scratchRoot), true);
    assert.equal(fs.readFileSync(path.join(workRoot, 'state.txt'), 'utf8'), 'old');
    assert.equal(fs.existsSync(stagingA), false);
    assert.equal(fs.existsSync(path.join(scratchRoot, 'restore-transaction.json')), false);

    const tokenB = '22222222-2222-4222-8222-222222222222';
    const backupB = path.join(scratchRoot, `work-backup-${tokenB}`);
    fs.renameSync(workRoot, backupB);
    fs.mkdirSync(workRoot, { recursive: true });
    fs.writeFileSync(path.join(workRoot, 'state.txt'), 'new-committed-before-marker');
    writeTransaction(scratchRoot, tokenB, 'backup-moved');

    assert.equal(recoverWorkspaceCheckpointRestore(workRoot, scratchRoot), true);
    assert.equal(
      fs.readFileSync(path.join(workRoot, 'state.txt'), 'utf8'),
      'old',
      'a crash before durable restore commit must roll back to the frozen backup',
    );

    const tokenC = '33333333-3333-4333-8333-333333333333';
    fs.rmSync(workRoot, { recursive: true, force: true });
    writeTransaction(scratchRoot, tokenC, 'backup-moved');
    assert.throws(
      () => recoverWorkspaceCheckpointRestore(workRoot, scratchRoot),
      /WORKSPACE_CHECKPOINT_RESTORE_RECOVERY_REQUIRED/,
    );

    const archiveSource = read('packages/agent-runner/src/controller/workspace-checkpoint-archive.ts');
    assert(archiveSource.includes("phase: 'prepared' | 'backup-moved'"));
    assert(archiveSource.includes("writeRestoreTransaction(scratchRoot, { version: 1, token, phase: 'prepared' })"));
    assert(
      archiveSource.includes("writeRestoreTransaction(scratchRoot, { version: 1, token, phase: 'backup-moved' })"),
    );

    const engineSource = read('packages/agent-runner/src/controller/workspace-runtime-engine.ts');
    assert(engineSource.includes('recoverWorkspaceCheckpointRestore(workRoot, scratchRoot);'));
    assert(
      engineSource.includes(
        "const missingWorkRoot = ['ready', 'running', 'stopped'].includes(state) && !fs.existsSync(workRoot);",
      ),
    );

    process.stdout.write('checkpoint restore crash recovery regression: PASS\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

main();
