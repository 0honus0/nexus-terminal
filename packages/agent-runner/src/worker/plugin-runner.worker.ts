import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  decodePluginJson,
  encodePluginJsonFrame,
  PluginIpcDecoder,
  type PluginIpcFrame,
  writePluginFrame,
} from '../plugin-ipc';
import { PLUGIN_RUNNER_PROTOCOL_VERSION, type RunnerPluginModuleV1, type RunnerPluginSdkV1 } from '../plugin-sdk.types';
import { PluginWorkspaceFiles } from '../controller/plugin-workspace-store';

type HostLifecycleRequest =
  | { kind: 'lifecycle.activate' }
  | { kind: 'lifecycle.health' }
  | { kind: 'lifecycle.quiesce'; deadlineUnixSeconds: number }
  | { kind: 'lifecycle.dispose' };

const workspaceId = process.env.NEXUS_WORKSPACE_ID?.trim() ?? '';
const generation = Number(process.env.NEXUS_WORKSPACE_GENERATION);
const pluginId = process.env.NEXUS_PLUGIN_ID?.trim() ?? '';
const pluginVersion = process.env.NEXUS_PLUGIN_VERSION?.trim() ?? '';
const sdkVersion = process.env.NEXUS_PLUGIN_SDK_VERSION?.trim() ?? '';
const protocolVersion = Number(process.env.NEXUS_PLUGIN_PROTOCOL_VERSION);
const entry = process.env.NEXUS_PLUGIN_RUNNER_ENTRY?.trim() ?? '';
const sourceRoot = process.env.NEXUS_PLUGIN_SOURCE_ROOT?.trim() ?? '';
const workspaceRoot = process.env.NEXUS_PLUGIN_WORKSPACE_ROOT?.trim() ?? '';

if (!/^[A-Za-z0-9_.-]{1,128}$/.test(workspaceId) || !Number.isSafeInteger(generation) || generation < 1) {
  throw new Error('PLUGIN_RUNNER_WORKSPACE_INVALID');
}
if (
  !/^[A-Za-z0-9_.-]{1,128}$/.test(pluginId) ||
  !pluginVersion ||
  pluginVersion.length > 128 ||
  /[\0\r\n]/.test(pluginVersion) ||
  !sdkVersion ||
  sdkVersion.length > 128 ||
  /[\0\r\n]/.test(sdkVersion) ||
  protocolVersion !== PLUGIN_RUNNER_PROTOCOL_VERSION
) {
  throw new Error('PLUGIN_RUNNER_IDENTITY_INVALID');
}
if (!/^runner\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:m?js|cjs)$/.test(entry) || entry.includes('..')) {
  throw new Error('PLUGIN_RUNNER_ENTRY_INVALID');
}
if (!sourceRoot || !path.isAbsolute(sourceRoot) || sourceRoot.includes('\0'))
  throw new Error('PLUGIN_RUNNER_SOURCE_INVALID');
if (!workspaceRoot || !path.isAbsolute(workspaceRoot) || workspaceRoot.includes('\0')) {
  throw new Error('PLUGIN_RUNNER_WORKSPACE_INVALID');
}

console.log = (...args: unknown[]) => console.error('[runner-plugin]', ...args);
console.info = (...args: unknown[]) => console.error('[runner-plugin]', ...args);
console.warn = (...args: unknown[]) => console.error('[runner-plugin]', ...args);

const files = new PluginWorkspaceFiles(workspaceRoot);
const sdk: RunnerPluginSdkV1 = Object.freeze({
  workspace: Object.freeze({
    read: async (logicalPath: string) => files.read(logicalPath),
    write: async (logicalPath: string, value: Uint8Array) => files.write(logicalPath, value),
    list: async (logicalPath: string) => files.list(logicalPath),
    stat: async (logicalPath: string) => files.stat(logicalPath),
    mkdir: async (logicalPath: string) => files.mkdir(logicalPath),
    rename: async (logicalPath: string, destinationPath: string) => files.rename(logicalPath, destinationPath),
    remove: async (logicalPath: string) => files.remove(logicalPath),
  }),
});

const decoder = new PluginIpcDecoder();
let lifecycleQueue = Promise.resolve();

const protocolFailure = (error: unknown): void => {
  console.error(
    '[runner-plugin-runtime] protocol error:',
    error instanceof Error ? error : new Error('PLUGIN_RUNNER_PROTOCOL_INVALID'),
  );
  process.exitCode = 1;
  process.stdin.destroy();
};

const startRuntime = async (): Promise<void> => {
  const entryPath = path.resolve(sourceRoot, entry);
  if (entryPath !== sourceRoot && !entryPath.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error('PLUGIN_RUNNER_ENTRY_INVALID');
  }
  const imported = await import(pathToFileURL(entryPath).href);
  const candidate = imported.default && typeof imported.default === 'object' ? imported.default : imported;
  const plugin = candidate as RunnerPluginModuleV1;
  const activationContext = Object.freeze({
    schemaVersion: 1 as const,
    protocolVersion: PLUGIN_RUNNER_PROTOCOL_VERSION,
    workspace: Object.freeze({ workspaceId, generation }),
    plugin: Object.freeze({ pluginId, version: pluginVersion, sdkVersion }),
    sdk,
  });

  const lifecycle = async (message: HostLifecycleRequest): Promise<unknown> => {
    switch (message.kind) {
      case 'lifecycle.activate':
        await plugin.activate?.(activationContext);
        return { activated: true };
      case 'lifecycle.health':
        return (await plugin.health?.()) ?? { available: true, reason: null };
      case 'lifecycle.quiesce':
        await plugin.quiesce?.(message.deadlineUnixSeconds);
        return { quiesced: true };
      case 'lifecycle.dispose':
        await plugin.dispose?.();
        return { disposed: true };
    }
  };

  const handleFrame = (frame: PluginIpcFrame): void => {
    const message = decodePluginJson(frame);
    lifecycleQueue = lifecycleQueue
      .then(async () => {
        if (
          frame.requestId === 0 ||
          !['lifecycle.activate', 'lifecycle.health', 'lifecycle.quiesce', 'lifecycle.dispose'].includes(
            String(message.kind),
          ) ||
          (message.kind === 'lifecycle.quiesce' &&
            (!Number.isSafeInteger(message.deadlineUnixSeconds) || Number(message.deadlineUnixSeconds) < 0))
        ) {
          throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
        }
        try {
          await writePluginFrame(
            process.stdout,
            encodePluginJsonFrame(frame.requestId, {
              kind: 'lifecycle.result',
              ok: true,
              value: await lifecycle(message as HostLifecycleRequest),
            }),
          );
        } catch (error) {
          await writePluginFrame(
            process.stdout,
            encodePluginJsonFrame(frame.requestId, {
              kind: 'lifecycle.result',
              ok: false,
              error: error instanceof Error ? error.message.slice(0, 1024) : 'PLUGIN_RUNNER_ERROR',
            }),
          );
        }
      })
      .catch(protocolFailure);
  };

  process.stdin.on('data', (chunk: Buffer) => {
    try {
      for (const frame of decoder.push(chunk)) handleFrame(frame);
    } catch (error) {
      protocolFailure(error);
    }
  });
  process.stdin.once('end', () => {
    try {
      decoder.end();
    } catch (error) {
      protocolFailure(error);
    }
  });
  await writePluginFrame(
    process.stdout,
    encodePluginJsonFrame(0, { kind: 'runtime.ready', protocolVersion: PLUGIN_RUNNER_PROTOCOL_VERSION, sdkVersion }),
  );
};

void startRuntime().catch((error) => {
  console.error('[runner-plugin-runtime] fatal:', error);
  process.exitCode = 1;
});
