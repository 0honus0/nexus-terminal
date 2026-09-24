import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CleanupPlanner } from '../../packages/agent-runner/src/controller/cleanup-planner';
import { PluginRunnerRuntime } from '../../packages/agent-runner/src/controller/plugin-runner-runtime';
import { SpaceReporter } from '../../packages/agent-runner/src/controller/space-reporter';
import { ToolchainMutationCoordinator } from '../../packages/agent-runner/src/controller/toolchain-mutation-coordinator';
import type { WorkspaceRecord } from '../../packages/agent-runner/src/types';

const workspace = (workspaceId: string, generation: number, status: WorkspaceRecord['status']): WorkspaceRecord => ({
  workspaceId,
  generation,
  status,
  retained: false,
  toolchain: [],
  runnerPlugins: [],
  acpProfiles: [],
  browserTarget: null,
});

const writeHome = (runtimeRoot: string, workspaceId: string, generation: number, bytes: number): string => {
  const directory = path.join(runtimeRoot, 'plugin-processes', workspaceId, String(generation), 'plugin.test');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'state.bin'), Buffer.alloc(bytes, 0x61));
  return directory;
};

const main = async (): Promise<void> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-plugin-home-retention-'));
  try {
    const runtimeRoot = path.join(root, 'runtime');
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const pluginRunner = new PluginRunnerRuntime(runtimeRoot, '');

    writeHome(runtimeRoot, 'workspace-owned', 1, 7);
    const currentHome = writeHome(runtimeRoot, 'workspace-owned', 2, 9);
    writeHome(runtimeRoot, 'workspace-orphan', 3, 11);
    writeHome(runtimeRoot, 'workspace-deleted', 4, 13);

    pluginRunner.reconcileHomes([
      workspace('workspace-owned', 2, 'stopped'),
      workspace('workspace-deleted', 4, 'deleted'),
    ]);

    assert.equal(fs.existsSync(path.join(runtimeRoot, 'plugin-processes', 'workspace-owned', '1')), false);
    assert.equal(fs.existsSync(currentHome), true, 'current generation HOME must be retained');
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'plugin-processes', 'workspace-orphan')), false);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'plugin-processes', 'workspace-deleted')), false);
    assert.equal(pluginRunner.workspaceHomeBytes('workspace-owned'), 9);

    const owned = workspace('workspace-owned', 2, 'stopped');
    const journal = {
      workspaces: () => [owned],
      jobs: () => [],
      deleteWorkspace: () => undefined,
      compact: () => undefined,
    } as never;
    const reporter = new SpaceReporter(
      root,
      journal,
      { load: () => ({ packs: [] }) } as never,
      { runtimeBytes: () => 5 } as never,
    );
    const report = await reporter.report();
    assert.deepEqual(report.byWorkspace, [{ workspaceId: 'workspace-owned', runtimeBytes: 14, status: 'stopped' }]);
    assert.equal(report.reclaimableBytes, report.cacheBytes + 14);

    const cleanup = new CleanupPlanner(
      root,
      journal,
      { remove: async () => undefined } as never,
      new ToolchainMutationCoordinator(),
      pluginRunner,
    );
    const result = await cleanup.runtimeCleanup(['workspace-owned']);
    assert.deepEqual(result, { deleted: ['workspace-owned'], quarantined: [], skipped: [] });
    assert.equal(
      fs.existsSync(path.join(runtimeRoot, 'plugin-processes', 'workspace-owned')),
      false,
      'runtime cleanup must remove the whole Workspace plugin HOME after process disposal',
    );

    process.stdout.write('runner plugin HOME retention regression: PASS\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
