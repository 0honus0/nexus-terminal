import assert from 'node:assert/strict';
import { AppRegistryService } from '../../packages/backend/src/modules/agent/host/app-registry.service';
import { PluginPackageInstallCoordinator } from '../../packages/backend/src/modules/agent/host/plugin-package-install-coordinator';
import type { AgentAppDefinition } from '../../packages/backend/src/modules/agent/host/app.types';
import type { PackageVerifierPort } from '../../packages/backend/src/modules/agent/host/package-verifier.port';
import type {
  PluginInstallRepositoryPort,
  PluginVersionRecord,
} from '../../packages/backend/src/modules/agent/host/plugin-install.repository.port';
import type { ClockPort } from '../../packages/backend/src/modules/agent/agent.types';

const plugin = (version: string, status: PluginVersionRecord['status'] = 'installed'): PluginVersionRecord =>
  ({ appId: 'plugin.retention.app', version, status }) as PluginVersionRecord;

const main = async (): Promise<void> => {
  const versions = [plugin('1.0.0'), plugin('2.0.0'), plugin('0.9.0', 'failed')];
  const removedPackages: string[] = [];
  const removedRegistryVersions: string[] = [];
  const statusUpdates: Array<{ version: string; status: string }> = [];

  const repository = {
    listVersions: async () => versions,
    countInstalled: async (_appId: string, version: string) => (version === '2.0.0' ? 1 : 0),
    updateVersionStatus: async (_appId: string, version: string, status: PluginVersionRecord['status']) => {
      statusUpdates.push({ version, status });
      return versions.find((candidate) => candidate.version === version)!;
    },
  } as unknown as PluginInstallRepositoryPort;
  const verifier = {
    removeInstalled: async (_appId: string, version: string) => {
      removedPackages.push(version);
    },
  } as unknown as PackageVerifierPort;
  const runtimeLifecycle = {
    removeVersion: (_appId: string, version: string) => {
      removedRegistryVersions.push(version);
    },
  };
  const clock: ClockPort = {
    nowUnixSeconds: () => 1234,
    nowUnixMilliseconds: () => 1_234_000,
  };

  const coordinator = new PluginPackageInstallCoordinator(
    repository,
    verifier,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    runtimeLifecycle as never,
    clock,
    '1.0.2',
  );

  await coordinator.reconcileInstalledVersions();

  assert.deepEqual(removedPackages, ['1.0.0'], 'startup must reclaim only installed versions with zero installations');
  assert.deepEqual(removedRegistryVersions, ['1.0.0']);
  assert.deepEqual(statusUpdates, [{ version: '1.0.0', status: 'removed' }]);

  const registry = new AppRegistryService();
  const definition = (version: string): AgentAppDefinition =>
    ({
      manifest: {
        id: 'plugin.retention.app',
        version,
        intents: [],
      },
    }) as AgentAppDefinition;
  registry.registerVersion(definition('1.0.0'));
  registry.registerVersion(definition('2.0.0'));
  assert.equal(registry.has('plugin.retention.app', '1.0.0'), true);
  registry.removeVersion('plugin.retention.app', '1.0.0');
  assert.equal(registry.has('plugin.retention.app', '1.0.0'), false);
  assert.equal(registry.has('plugin.retention.app', '2.0.0'), true);

  process.stdout.write('agent plugin version retention regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
