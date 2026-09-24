import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolchainStore } from '../../packages/agent-runner/src/controller/toolchain-store';
import { SpaceReporter } from '../../packages/agent-runner/src/controller/space-reporter';
import { decodeStorage } from '../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-http-protocol';

const ref = (familyId: string, versionId: string, digestByte: string) => ({
  familyId,
  versionId,
  contentDigest: `sha256:${digestByte.repeat(64)}`,
});

const main = async (): Promise<void> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-toolchain-staging-retention-'));
  try {
    const packsRoot = path.join(root, 'packs');
    const orphan = path.join(packsRoot, '.staging', 'old-command-node-1.0.0-deadbeef');
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, 'large-orphan.bin'), Buffer.alloc(32, 0x61));

    const store = new ToolchainStore(packsRoot);
    assert.equal(fs.existsSync(orphan), false, 'Runner startup must sweep stale Toolchain staging trees');

    const commandId = 'command-owner-1234';
    const first = store.stagingPath(commandId, ref('node', '1.0.0', 'a'));
    const second = store.stagingPath(commandId, ref('python', '3.12.0', 'b'));
    const other = store.stagingPath('other-command-5678', ref('go', '1.23.0', 'c'));
    for (const [directory, bytes] of [
      [first, 11],
      [second, 13],
      [other, 17],
    ] as const) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'payload.bin'), Buffer.alloc(bytes, 0x62));
    }

    assert.equal(store.discardCommandStaging(commandId), 2);
    assert.equal(fs.existsSync(first), false);
    assert.equal(fs.existsSync(second), false);
    assert.equal(fs.existsSync(other), true, 'command cleanup must not delete another active command staging tree');

    const reporter = new SpaceReporter(
      root,
      { workspaces: () => [] } as never,
      { load: () => ({ packs: [] }) } as never,
      { runtimeBytes: () => 0 } as never,
    );
    const report = await reporter.report();
    assert.equal(report.stagingPackBytes, 17);
    assert(report.packBytes >= report.stagingPackBytes);

    const decoded = decodeStorage({
      ...report,
      filesystem: { totalBytes: 1, freeBytes: 1 },
    });
    assert.equal(decoded.stagingPackBytes, 17, 'Backend Storage decoder must preserve staging Pack accounting');

    const installerSource = fs.readFileSync(
      new URL('../../packages/agent-runner/src/controller/pack-installer.ts', import.meta.url),
      'utf8',
    );
    assert(
      installerSource.includes('this.store.discardCommandStaging(commandId);'),
      'PackInstaller ensure finally must release all command-scoped staging directories',
    );

    process.stdout.write('runner Toolchain staging retention regression: PASS\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
