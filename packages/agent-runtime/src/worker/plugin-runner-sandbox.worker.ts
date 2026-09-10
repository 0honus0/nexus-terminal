import { pathToFileURL } from 'node:url';
import {
  decodePluginJson,
  encodePluginBinaryFrame,
  encodePluginJsonFrame,
  PluginIpcDecoder,
  type PluginIpcFrame,
  writePluginFrame,
} from '../plugin-ipc';
import { PLUGIN_RUNNER_PROTOCOL_VERSION, type RunnerPluginModuleV1, type RunnerPluginSdkV1 } from '../plugin-sdk.types';

type HostLifecycleRequest =
  | { kind: 'lifecycle.activate' }
  | { kind: 'lifecycle.health' }
  | { kind: 'lifecycle.quiesce'; deadlineUnixSeconds: number }
  | { kind: 'lifecycle.dispose' };

type HostWorkspaceResponse =
  { kind: 'workspace.result'; ok: true; value: unknown } | { kind: 'workspace.result'; ok: false; error: string };

type HostMessage = HostLifecycleRequest | HostWorkspaceResponse;

type WorkspaceRequestInput =
  | { kind: 'workspace.read'; targetPluginId: string; path: string }
  | { kind: 'workspace.write'; targetPluginId: string; path: string }
  | { kind: 'workspace.list'; targetPluginId: string; path: string }
  | { kind: 'workspace.stat'; targetPluginId: string; path: string }
  | { kind: 'workspace.mkdir'; targetPluginId: string; path: string }
  | { kind: 'workspace.rename'; targetPluginId: string; path: string; destinationPath: string }
  | { kind: 'workspace.remove'; targetPluginId: string; path: string };

const environmentId = process.env.NEXUS_ENVIRONMENT_ID?.trim() ?? '';
const generation = Number(process.env.NEXUS_ENVIRONMENT_GENERATION);
const pluginId = process.env.NEXUS_PLUGIN_ID?.trim() ?? '';
const pluginVersion = process.env.NEXUS_PLUGIN_VERSION?.trim() ?? '';
const sdkVersion = process.env.NEXUS_PLUGIN_SDK_VERSION?.trim() ?? '';
const protocolVersion = Number(process.env.NEXUS_PLUGIN_PROTOCOL_VERSION);
const entry = process.env.NEXUS_PLUGIN_RUNNER_ENTRY?.trim() ?? '';
if (!/^[A-Za-z0-9_.-]{1,128}$/.test(environmentId) || !Number.isSafeInteger(generation) || generation < 1) {
  throw new Error('PLUGIN_RUNNER_ENVIRONMENT_INVALID');
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

console.log = (...args: unknown[]) => console.error('[runner-plugin]', ...args);
console.info = (...args: unknown[]) => console.error('[runner-plugin]', ...args);
console.warn = (...args: unknown[]) => console.error('[runner-plugin]', ...args);

interface PendingWorkspaceRequest {
  expected: 'json' | 'binary';
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

const decoder = new PluginIpcDecoder();
let lifecycleQueue = Promise.resolve();
let sequence = 0;
const pendingWorkspace = new Map<number, PendingWorkspaceRequest>();

const nextRequestId = (): number => {
  sequence = sequence >= 0xffff_ffff ? 1 : sequence + 1;
  if (pendingWorkspace.has(sequence)) throw new Error('PLUGIN_RUNNER_REQUEST_ID_EXHAUSTED');
  return sequence;
};

const beginWorkspaceRequest = (requestId: number, expected: PendingWorkspaceRequest['expected']): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingWorkspace.delete(requestId);
      reject(new Error('PLUGIN_RUNNER_TIMEOUT'));
    }, 30_000);
    timer.unref?.();
    pendingWorkspace.set(requestId, { expected, resolve, reject, timer });
  });

const failWorkspaceRequest = (requestId: number, error: unknown): void => {
  const pending = pendingWorkspace.get(requestId);
  if (!pending) return;
  pendingWorkspace.delete(requestId);
  clearTimeout(pending.timer);
  pending.reject(error instanceof Error ? error : new Error('PLUGIN_RUNNER_NOT_RUNNING'));
};

const protocolFailure = (error: unknown): void => {
  const failure = error instanceof Error ? error : new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
  console.error('[runner-plugin-runtime] protocol error:', failure);
  for (const [requestId, pending] of pendingWorkspace) {
    pendingWorkspace.delete(requestId);
    clearTimeout(pending.timer);
    pending.reject(failure);
  }
  process.exitCode = 1;
  process.stdin.destroy();
};

const workspaceRequest = async (request: WorkspaceRequestInput): Promise<unknown> => {
  const requestId = nextRequestId();
  const result = beginWorkspaceRequest(requestId, request.kind === 'workspace.read' ? 'binary' : 'json');
  try {
    await writePluginFrame(process.stdout, encodePluginJsonFrame(requestId, request));
  } catch (error) {
    failWorkspaceRequest(requestId, error);
    throw error;
  }
  return result;
};

const workspaceWrite = async (targetPluginId: string, path: string, value: Uint8Array): Promise<void> => {
  const requestId = nextRequestId();
  const binaryFrame = encodePluginBinaryFrame(requestId, value);
  const result = beginWorkspaceRequest(requestId, 'json');
  try {
    await writePluginFrame(
      process.stdout,
      encodePluginJsonFrame(requestId, { kind: 'workspace.write', targetPluginId, path }),
    );
    await writePluginFrame(process.stdout, binaryFrame);
    await result;
  } catch (error) {
    failWorkspaceRequest(requestId, error);
    throw error;
  }
};

const sdk: RunnerPluginSdkV1 = Object.freeze({
  workspace: Object.freeze({
    read: async (targetPluginId: string, path: string) =>
      Buffer.from((await workspaceRequest({ kind: 'workspace.read', targetPluginId, path })) as Uint8Array),
    write: async (targetPluginId: string, path: string, value: Uint8Array) => {
      if (!(value instanceof Uint8Array)) throw new Error('WORKSPACE_VALUE_INVALID');
      await workspaceWrite(targetPluginId, path, value);
    },
    list: async (targetPluginId: string, path: string) => {
      const value = await workspaceRequest({ kind: 'workspace.list', targetPluginId, path });
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
        throw new Error('WORKSPACE_RESPONSE_INVALID');
      return value as string[];
    },
    stat: async (targetPluginId: string, path: string) =>
      (await workspaceRequest({ kind: 'workspace.stat', targetPluginId, path })) as {
        type: 'file' | 'directory';
        sizeBytes: number;
        modifiedAtMs: number;
      },
    mkdir: async (targetPluginId: string, path: string) => {
      await workspaceRequest({ kind: 'workspace.mkdir', targetPluginId, path });
    },
    rename: async (targetPluginId: string, path: string, destinationPath: string) => {
      await workspaceRequest({ kind: 'workspace.rename', targetPluginId, path, destinationPath });
    },
    remove: async (targetPluginId: string, path: string) => {
      await workspaceRequest({ kind: 'workspace.remove', targetPluginId, path });
    },
  }),
});

const startRuntime = async (): Promise<void> => {
  const imported = await import(pathToFileURL(`/plugin/${entry}`).href);
  const candidate = imported.default && typeof imported.default === 'object' ? imported.default : imported;
  const plugin = candidate as RunnerPluginModuleV1;
  const activationContext = Object.freeze({
    schemaVersion: 1 as const,
    protocolVersion: PLUGIN_RUNNER_PROTOCOL_VERSION,
    environment: Object.freeze({ environmentId, generation }),
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
    if (frame.type === 'binary') {
      const pending = pendingWorkspace.get(frame.requestId);
      if (!pending || pending.expected !== 'binary') throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
      pendingWorkspace.delete(frame.requestId);
      clearTimeout(pending.timer);
      pending.resolve(frame.payload);
      return;
    }
    const message = decodePluginJson(frame) as HostMessage;
    if (message.kind === 'workspace.result') {
      const pending = pendingWorkspace.get(frame.requestId);
      if (!pending) return;
      pendingWorkspace.delete(frame.requestId);
      clearTimeout(pending.timer);
      if (!message.ok) {
        if (typeof message.error !== 'string') throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
        pending.reject(new Error(message.error));
      } else if (pending.expected === 'json') {
        pending.resolve(message.value);
      } else {
        const error = new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
        pending.reject(error);
        throw error;
      }
      return;
    }
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
              value: await lifecycle(message),
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
