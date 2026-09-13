import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import type {
  PluginBackendModuleV1,
  PluginBackendSdkV1,
  PluginBackendStorageRecord,
  PLUGIN_BACKEND_PROTOCOL_VERSION as PluginBackendProtocolVersion,
} from '../../../modules/agent/host/plugin-sdk.types';
import type { JsonValue } from '../../../modules/agent/agent.types';

const PLUGIN_BACKEND_PROTOCOL_VERSION: typeof PluginBackendProtocolVersion = 1;

type HostLifecycleRequest =
  | { kind: 'lifecycle.activate'; requestId: number }
  | { kind: 'lifecycle.health'; requestId: number }
  | { kind: 'lifecycle.quiesce'; requestId: number; deadlineUnixSeconds: number }
  | { kind: 'lifecycle.dispose'; requestId: number }
  | { kind: 'lifecycle.migrate'; requestId: number; fromVersion: string | null; storage: unknown };

type HostStorageResponse =
  | { kind: 'storage.result'; requestId: number; ok: true; value: unknown }
  | { kind: 'storage.result'; requestId: number; ok: false; error: string };

type HostMessage = HostLifecycleRequest | HostStorageResponse;

type WorkerStorageRequest =
  | { kind: 'storage.get'; requestId: number; key: string }
  | { kind: 'storage.put'; requestId: number; key: string; value: JsonValue; expectedVersion: number | null }
  | { kind: 'storage.delete'; requestId: number; key: string; expectedVersion: number };

type WorkerStorageRequestInput =
  | { kind: 'storage.get'; key: string }
  | { kind: 'storage.put'; key: string; value: JsonValue; expectedVersion: number | null }
  | { kind: 'storage.delete'; key: string; expectedVersion: number };

const userId = Number(process.env.NEXUS_PLUGIN_USER_ID);
const appId = process.env.NEXUS_PLUGIN_APP_ID?.trim() ?? '';
const pluginVersion = process.env.NEXUS_PLUGIN_VERSION?.trim() ?? '';
const sdkVersion = process.env.NEXUS_PLUGIN_SDK_VERSION?.trim() ?? '';
const protocolVersion = Number(process.env.NEXUS_PLUGIN_PROTOCOL_VERSION);
const entry = process.env.NEXUS_PLUGIN_BACKEND_ENTRY?.trim() ?? '';
const pluginRoot = process.env.NEXUS_PLUGIN_ROOT?.trim() ?? '';
if (
  !Number.isSafeInteger(userId) ||
  userId < 1 ||
  !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.test(appId) ||
  !pluginVersion ||
  pluginVersion.length > 128 ||
  /[\0\r\n]/.test(pluginVersion) ||
  !sdkVersion ||
  sdkVersion.length > 128 ||
  /[\0\r\n]/.test(sdkVersion) ||
  !path.isAbsolute(pluginRoot) ||
  /[\0\r\n]/.test(pluginRoot) ||
  protocolVersion !== PLUGIN_BACKEND_PROTOCOL_VERSION
) {
  throw new Error('PLUGIN_BACKEND_IDENTITY_INVALID');
}
if (!/^backend\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:m?js|cjs)$/.test(entry) || entry.includes('..')) {
  throw new Error('PLUGIN_BACKEND_ENTRY_INVALID');
}

console.log = (...args: unknown[]) => console.error('[plugin]', ...args);
console.info = (...args: unknown[]) => console.error('[plugin]', ...args);
console.warn = (...args: unknown[]) => console.error('[plugin]', ...args);

const send = (message: unknown): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};
let sdkRequestId = 0;
const pendingStorage = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

const storageRequest = (request: WorkerStorageRequestInput): Promise<unknown> => {
  const requestId = ++sdkRequestId;
  send({ ...request, requestId });
  return new Promise((resolve, reject) => pendingStorage.set(requestId, { resolve, reject }));
};

const storageRecord = (value: unknown): PluginBackendStorageRecord | null => {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('PLUGIN_BACKEND_STORAGE_RESPONSE_INVALID');
  const record = value as Record<string, unknown>;
  if (
    typeof record.key !== 'string' ||
    !Number.isSafeInteger(record.version) ||
    (record.version as number) < 1 ||
    !Number.isSafeInteger(record.updatedAt) ||
    (record.updatedAt as number) < 0 ||
    !Object.prototype.hasOwnProperty.call(record, 'value')
  ) {
    throw new Error('PLUGIN_BACKEND_STORAGE_RESPONSE_INVALID');
  }
  return record as unknown as PluginBackendStorageRecord;
};

const sdk: PluginBackendSdkV1 = Object.freeze({
  storage: Object.freeze({
    get: async (key: string) => storageRecord(await storageRequest({ kind: 'storage.get', key })),
    put: async (key: string, value: JsonValue, expectedVersion: number | null) => {
      const result = storageRecord(await storageRequest({ kind: 'storage.put', key, value, expectedVersion }));
      if (!result) throw new Error('PLUGIN_BACKEND_STORAGE_RESPONSE_INVALID');
      return result;
    },
    delete: async (key: string, expectedVersion: number) =>
      Boolean(await storageRequest({ kind: 'storage.delete', key, expectedVersion })),
  }),
});
const scope = Object.freeze({ userId, appId });

const startRuntime = async (): Promise<void> => {
  const entryPath = path.resolve(pluginRoot, entry);
  if (!entryPath.startsWith(`${pluginRoot}${path.sep}`)) throw new Error('PLUGIN_BACKEND_ENTRY_INVALID');
  const imported = await import(pathToFileURL(entryPath).href);
  const candidate = imported.default && typeof imported.default === 'object' ? imported.default : imported;
  const plugin = candidate as PluginBackendModuleV1;
  const activationContext = Object.freeze({
    schemaVersion: 1 as const,
    protocolVersion: PLUGIN_BACKEND_PROTOCOL_VERSION,
    scope,
    plugin: Object.freeze({ pluginId: appId, version: pluginVersion, sdkVersion }),
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
      case 'lifecycle.migrate':
        return plugin.migrate
          ? await plugin.migrate({ fromVersion: message.fromVersion, storage: message.storage })
          : message.storage;
    }
  };

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', (line) => {
    void (async () => {
      let message: HostMessage;
      try {
        message = JSON.parse(line) as HostMessage;
      } catch {
        throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
      }
      if (message.kind === 'storage.result') {
        const pending = pendingStorage.get(message.requestId);
        if (!pending) return;
        pendingStorage.delete(message.requestId);
        if (message.ok) pending.resolve(message.value);
        else pending.reject(new Error(message.error));
        return;
      }
      try {
        const value = await lifecycle(message);
        send({ kind: 'lifecycle.result', requestId: message.requestId, ok: true, value });
        if (message.kind === 'lifecycle.dispose') process.exitCode = 0;
      } catch (error) {
        send({
          kind: 'lifecycle.result',
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 1024) : 'PLUGIN_BACKEND_ERROR',
        });
      }
    })().catch((error) => {
      console.error('[plugin-runtime] protocol error:', error);
      process.exitCode = 1;
    });
  });

  send({ kind: 'runtime.ready', protocolVersion: PLUGIN_BACKEND_PROTOCOL_VERSION, sdkVersion });
};

void startRuntime().catch((error) => {
  console.error('[plugin-runtime] fatal:', error);
  process.exitCode = 1;
});
