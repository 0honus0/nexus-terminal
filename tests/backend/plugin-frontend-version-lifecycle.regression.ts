import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PluginDataManager } from '../../packages/backend/src/modules/agent/host/plugin-data-manager';

const state = (activeVersion: string) => ({
  userId: 1,
  appId: 'fixture.plugin',
  activeVersion,
  desiredState: 'enabled',
  observedState: 'running',
});

const manager = (installationVersion: string, activeVersion = installationVersion) =>
  new PluginDataManager(
    {
      getInstallation: async () => ({ version: installationVersion, status: 'installed' }),
      getVersion: async () => ({
        version: installationVersion,
        status: 'installed',
        manifest: {
          sdkVersion: '1.0.0',
          displayName: 'Fixture plugin',
          capabilities: [],
        },
      }),
    } as never,
    { get: async () => state(activeVersion) } as never,
    {} as never,
    {} as never,
  );

const main = async (): Promise<void> => {
  await assert.rejects(
    () =>
      manager('2.0.0').frontendRpc(1, 'fixture.plugin', {
        version: '1.0.0',
        method: 'host.appInfo',
        params: {},
      }),
    /PLUGIN_FRONTEND_VERSION_STALE/,
    'an old frontend descriptor must not execute against the current installation',
  );

  await assert.rejects(
    () =>
      manager('2.0.0', '3.0.0').frontendRpc(1, 'fixture.plugin', {
        version: '2.0.0',
        method: 'host.appInfo',
        params: {},
      }),
    /PLUGIN_FRONTEND_VERSION_STALE/,
    'frontend RPC must also match the current app activeVersion',
  );

  const current = await manager('2.0.0').frontendRpc(1, 'fixture.plugin', {
    version: '2.0.0',
    method: 'host.appInfo',
    params: {},
  });
  assert.deepEqual(current, {
    appId: 'fixture.plugin',
    version: '2.0.0',
    sdkVersion: '1.0.0',
    protocolVersion: 1,
    displayName: 'Fixture plugin',
    declaredCapabilities: [],
  });

  const root = path.resolve(process.cwd(), '../..');
  const read = (relativePath: string): string => readFileSync(path.join(root, relativePath), 'utf8');

  const hub = read('packages/frontend/src/features/agent/host/AgentHubWindow.vue');
  assert(!hub.includes('<KeepAlive>'), 'surface lifetime must not rely on an unprunable key cache');
  assert(hub.includes('const residentAppSurfaces = ref<ResidentAppSurface[]>([]);'));
  assert(hub.includes('current.version !== resident.version'));
  assert(hub.includes('residentAppSurfaces.value.filter((resident) => resident.appId !== appId)'));
  assert(hub.includes('v-for="resident in residentAppSurfaces"'));
  assert(hub.includes('v-show='));
  assert(hub.includes(':version="resident.version"'));

  const frame = read('packages/frontend/src/features/agent/host/PluginAppFrame.vue');
  assert(frame.includes('defineProps<{ appId: string; version: string }>()'));
  assert(frame.includes('next.version !== props.version'));
  assert(frame.includes('() => [props.appId, props.version] as const'));

  const bridge = read('packages/frontend/src/features/agent/plugin-sdk/host-bridge.ts');
  assert(bridge.includes('this.descriptor.version'));
  assert(bridge.includes('await this.assertDescriptorVersion(controller.signal);'));
  assert(bridge.includes("if (code === 'PLUGIN_FRONTEND_VERSION_STALE') this.disconnect();"));

  const route = read('packages/backend/src/interfaces/http/agent/plugins.routes.ts');
  assert(route.includes("hasOnlyKeys(request.body, ['version', 'method', 'params', 'operationId'])"));
  assert(route.includes('version: request.body.version'));

  process.stdout.write('plugin frontend version lifecycle regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
