import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolchainStore } from '../../packages/agent-runner/src/controller/toolchain-store';
import type { ToolchainPackRef } from '../../packages/agent-runner/src/types';

const root = new URL('../../', import.meta.url);
const read = (relativePath: string): string => fs.readFileSync(new URL(relativePath, root), 'utf8');

const lockSource = (current: string): void => {
  const stat = fs.lstatSync(current);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(current)) lockSource(path.join(current, name));
    fs.chmodSync(current, 0o555);
    return;
  }
  fs.chmodSync(current, stat.mode & 0o111 ? 0o555 : 0o444);
};

const preparePack = (store: ToolchainStore, ref: ToolchainPackRef, label: string): void => {
  const source = store.path(ref);
  fs.mkdirSync(path.join(source, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(source, 'bin', 'nxprobe'), `#!/bin/sh\nprintf '%s\\n' '${label}'\n`, {
    mode: 0o755,
  });
  fs.symlinkSync('nxprobe', path.join(source, 'bin', 'nxprobe-link'));
  fs.writeFileSync(path.join(source, 'lib', 'prefix.txt'), `${store.canonicalPath(ref)}/lib\n`, {
    mode: 0o644,
  });
  store.writeMarker(source, ref, 1);
  lockSource(source);
};

const runProbe = (executionPath: string): string =>
  execFileSync('/bin/sh', ['-c', 'nxprobe'], {
    encoding: 'utf8',
    env: { PATH: `${path.join(executionPath, 'bin')}:/usr/bin:/bin` },
  }).trim();

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-toolchain-execution-view-'));
try {
  const store = new ToolchainStore(path.join(directory, 'packs'));
  const refA: ToolchainPackRef = {
    familyId: 'node',
    versionId: '20',
    contentDigest: `sha256:${'a'.repeat(64)}`,
  };
  const refB: ToolchainPackRef = {
    familyId: 'node',
    versionId: '20',
    contentDigest: `sha256:${'b'.repeat(64)}`,
  };
  preparePack(store, refA, 'digest-a');
  preparePack(store, refB, 'digest-b');

  const viewA = store.executionPath(refA);
  assert.equal(runProbe(viewA), 'digest-a');
  assert.equal(fs.readlinkSync(path.join(viewA, 'bin', 'nxprobe-link')), 'nxprobe');
  assert.notEqual(viewA, store.canonicalPath(refA));
  const aPrefix = fs.readFileSync(path.join(viewA, 'lib', 'prefix.txt'), 'utf8').trim();
  assert.equal(aPrefix, `${viewA}/lib`);
  assert.equal(
    fs.readFileSync(path.join(store.path(refA), 'lib', 'prefix.txt'), 'utf8').trim(),
    `${store.canonicalPath(refA)}/lib`,
    'runtime relocation must not mutate the verified source pack',
  );

  const viewB = store.executionPath(refB);
  assert.notEqual(viewA, viewB, 'same family/version with different digests must have different execution roots');
  assert.equal(runProbe(viewB), 'digest-b');
  assert.equal(
    runProbe(viewA),
    'digest-a',
    'creating another digest execution view must not change a long-lived Workspace PATH',
  );
  assert.equal(fs.readFileSync(path.join(viewA, 'lib', 'prefix.txt'), 'utf8').trim(), `${viewA}/lib`);

  const manager = read('packages/agent-runner/src/controller/workspace-runtime-manager.ts');
  const prepareStart = manager.indexOf('private prepareExecution(');
  const prepareEnd = manager.indexOf('private resolveLogicalPath(', prepareStart);
  const prepare = manager.slice(prepareStart, prepareEnd);
  assert(prepare.includes('const target = this.store.executionPath(pack);'));
  assert(!prepare.includes('this.store.activate(pack);'));
  assert(!prepare.includes('this.store.canonicalPath(pack)'));

  const storeSource = read('packages/agent-runner/src/controller/toolchain-store.ts');
  const activateStart = storeSource.indexOf('activate(ref: ToolchainPackRef)');
  const activateEnd = storeSource.indexOf('stagingPath(', activateStart);
  const activate = storeSource.slice(activateStart, activateEnd);
  assert(activate.includes('fs.renameSync(temporary, canonical);'));
  assert(
    !activate.includes('fs.rmSync(canonical'),
    'canonical convenience alias updates must not expose an rm→rename missing-path window',
  );

  store.remove(refA);
  assert.equal(fs.existsSync(viewA), false, 'pack removal must reclaim its digest-scoped execution view');
  store.remove(refB);

  process.stdout.write('toolchain digest execution view regression: PASS\n');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
