import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CleanupPlanner } from '../../packages/agent-runner/src/controller/cleanup-planner';
import { PackInstaller } from '../../packages/agent-runner/src/controller/pack-installer';
import { RunnerControllerServer } from '../../packages/agent-runner/src/controller/server';
import { ToolchainMutationCoordinator } from '../../packages/agent-runner/src/controller/toolchain-mutation-coordinator';

const digest = `sha256:${'a'.repeat(64)}`;
const ref = { familyId: 'node', versionId: '1.2.3', contentDigest: digest };
const catalog = {
  pack: () => ({
    familyId: ref.familyId,
    versionId: ref.versionId,
    contentDigestByArch: { [process.arch]: digest },
    downloadRefByArch: { [process.arch]: `builtin://${ref.familyId}/${ref.versionId}/${process.arch}` },
    dependencies: [],
  }),
} as never;

const main = async (): Promise<void> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-toolchain-serialization-'));
  try {
    const cacheRoot = path.join(root, 'cache');
    const coordinator = new ToolchainMutationCoordinator();
    const store = {
      installed: () => false,
      activate: () => undefined,
    } as never;
    const installer = new PackInstaller(catalog, store, cacheRoot, coordinator);
    const cleanup = new CleanupPlanner(root, {} as never, {} as never, coordinator);
    const internal = installer as unknown as {
      installOne: (_pack: unknown, _ref: unknown, commandId: string) => Promise<void>;
    };

    let installEnteredResolve: (() => void) | undefined;
    let releaseInstallResolve: (() => void) | undefined;
    const installEntered = new Promise<void>((resolve) => {
      installEnteredResolve = resolve;
    });
    const releaseInstall = new Promise<void>((resolve) => {
      releaseInstallResolve = resolve;
    });
    internal.installOne = async (_pack, _candidate, commandId) => {
      const directory = path.join(cacheRoot, 'download', commandId);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'active-install'), '1');
      installEnteredResolve?.();
      await releaseInstall;
    };

    const ensure = installer.ensure([ref], 'provision-command');
    await installEntered;
    const cleanupPromise = cleanup.cacheCleanup();
    await Promise.resolve();
    assert.equal(
      fs.existsSync(path.join(cacheRoot, 'download', 'provision-command', 'active-install')),
      true,
      'cache cleanup must wait behind an active provision/install mutation',
    );
    releaseInstallResolve?.();
    await ensure;
    await cleanupPromise;
    assert.equal(fs.existsSync(path.join(root, 'cache')), true);

    const outcomes = new Map<string, { status: 'succeeded' | 'failed'; value: unknown }>();
    let adminEnteredResolve: (() => void) | undefined;
    let releaseAdminResolve: (() => void) | undefined;
    const adminEntered = new Promise<void>((resolve) => {
      adminEnteredResolve = resolve;
    });
    const releaseAdmin = new Promise<void>((resolve) => {
      releaseAdminResolve = resolve;
    });
    let installed = false;
    let uninstallCalls = 0;
    const server = new RunnerControllerServer({
      token: 'x'.repeat(32),
      catalog: {} as never,
      journal: {
        workspaces: () => [],
        succeed: (id: string, value: unknown) => outcomes.set(id, { status: 'succeeded', value }),
        fail: (id: string, value: unknown) => outcomes.set(id, { status: 'failed', value }),
      } as never,
      runtimeEngine: {} as never,
      installer: {
        ensure: async () => {
          adminEnteredResolve?.();
          await releaseAdmin;
          installed = true;
        },
        uninstall: async () => {
          uninstallCalls += 1;
          installed = false;
        },
        installed: () => installed,
      } as never,
      storage: {} as never,
      cleanup: {
        cacheCleanup: async () => ({ cleared: true as const }),
        runtimeCleanup: async () => ({ deleted: [], skipped: [], quarantined: [] }),
      } as never,
      pluginRunner: {} as never,
      acpRuntime: {} as never,
      terminalRuntime: {} as never,
      browserTunnel: {} as never,
    });
    const execute = (
      server as unknown as {
        executeAdminCommand(command: Record<string, unknown>, action: 'packInstall' | 'packUninstall'): Promise<void>;
      }
    ).executeAdminCommand.bind(server);

    const first = execute({ commandId: 'install-command', packs: [ref] }, 'packInstall');
    await adminEntered;
    const second = execute({ commandId: 'uninstall-command', pack: ref }, 'packUninstall');
    await second;
    assert.deepEqual(outcomes.get('uninstall-command'), {
      status: 'failed',
      value: 'RUNNER_TOOLCHAIN_MUTATION_BUSY',
    });
    assert.equal(uninstallCalls, 0, 'conflicting admin uninstall must not enter installer while install is active');

    releaseAdminResolve?.();
    await first;
    assert.equal(outcomes.get('install-command')?.status, 'succeeded');
    assert.equal(installed, true);

    process.stdout.write('runner toolchain admin serialization regression: PASS\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
