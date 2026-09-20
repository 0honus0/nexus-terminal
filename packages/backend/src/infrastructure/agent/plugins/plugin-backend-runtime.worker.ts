import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import {
  type PluginBackendAppIntentArtifact,
  type PluginBackendAppIntentReceipt,
  type PluginBackendModuleV1,
  type PluginBackendSdkV1,
  type PluginBackendStorageRecord,
  type PLUGIN_BACKEND_PROTOCOL_VERSION as PluginBackendProtocolVersion,
} from '../../../modules/agent/host/plugin-sdk.types';
import type { JsonValue } from '../../../modules/agent/agent.types';

const PLUGIN_BACKEND_PROTOCOL_VERSION: typeof PluginBackendProtocolVersion = 1;
const PLUGIN_APP_INTENT_ARTIFACT_CHUNK_BYTES = 128 * 1024;

type HostLifecycleRequest =
  | { kind: 'lifecycle.activate'; requestId: number }
  | { kind: 'lifecycle.health'; requestId: number }
  | { kind: 'lifecycle.quiesce'; requestId: number; deadlineUnixSeconds: number }
  | { kind: 'lifecycle.dispose'; requestId: number }
  | { kind: 'lifecycle.migrate'; requestId: number; fromVersion: string | null; storage: unknown };

type HostSdkResponse =
  | { kind: 'storage.result'; requestId: number; ok: true; value: unknown }
  | { kind: 'storage.result'; requestId: number; ok: false; error: string }
  | { kind: 'intent.result'; requestId: number; ok: true; value: unknown }
  | { kind: 'intent.result'; requestId: number; ok: false; error: string };

type HostMessage = HostLifecycleRequest | HostSdkResponse;

type WorkerStorageRequest =
  | { kind: 'storage.get'; requestId: number; key: string }
  | { kind: 'storage.put'; requestId: number; key: string; value: JsonValue; expectedVersion: number | null }
  | { kind: 'storage.delete'; requestId: number; key: string; expectedVersion: number };

type WorkerStorageRequestInput =
  | { kind: 'storage.get'; key: string }
  | { kind: 'storage.put'; key: string; value: JsonValue; expectedVersion: number | null }
  | { kind: 'storage.delete'; key: string; expectedVersion: number };

type WorkerIntentRequestInput =
  | {
      kind: 'intent.create';
      receiverAppId: string;
      intentId: string;
      input: JsonValue;
      artifactRefs: Array<{ appId: string; id: string }>;
      confirmed: true;
    }
  | { kind: 'intent.listReceived'; limit?: number }
  | { kind: 'intent.revoke'; receiptId: string }
  | { kind: 'intent.artifact.get'; receiptId: string; artifactId: string }
  | { kind: 'intent.artifact.read'; receiptId: string; artifactId: string; start: number; endInclusive: number };

const decodeHostMessage = (value: unknown): HostMessage => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.requestId) || Number(record.requestId) < 1) {
    throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
  }
  const requestId = Number(record.requestId);
  switch (record.kind) {
    case 'lifecycle.activate':
    case 'lifecycle.health':
    case 'lifecycle.dispose':
      return { kind: record.kind, requestId };
    case 'lifecycle.quiesce':
      if (!Number.isSafeInteger(record.deadlineUnixSeconds) || Number(record.deadlineUnixSeconds) < 0)
        throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
      return { kind: record.kind, requestId, deadlineUnixSeconds: Number(record.deadlineUnixSeconds) };
    case 'lifecycle.migrate':
      if (record.fromVersion !== null && typeof record.fromVersion !== 'string')
        throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
      return {
        kind: record.kind,
        requestId,
        fromVersion: record.fromVersion,
        storage: record.storage,
      };
    case 'storage.result':
    case 'intent.result':
      if (record.ok === true) return { kind: record.kind, requestId, ok: true, value: record.value };
      if (record.ok === false && typeof record.error === 'string' && record.error.length <= 1024) {
        return { kind: record.kind, requestId, ok: false, error: record.error };
      }
      throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
    default:
      throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
  }
};

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
const pendingIntents = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

const storageRequest = (request: WorkerStorageRequestInput): Promise<unknown> => {
  const requestId = ++sdkRequestId;
  send({ ...request, requestId });
  return new Promise((resolve, reject) => pendingStorage.set(requestId, { resolve, reject }));
};

const intentRequest = (request: WorkerIntentRequestInput): Promise<unknown> => {
  const requestId = ++sdkRequestId;
  send({ ...request, requestId });
  return new Promise((resolve, reject) => pendingIntents.set(requestId, { resolve, reject }));
};

const intentReceipt = (value: unknown): PluginBackendAppIntentReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PLUGIN_BACKEND_INTENT_RESPONSE_INVALID');
  }
  return value as PluginBackendAppIntentReceipt;
};

const intentArtifact = (value: unknown): PluginBackendAppIntentArtifact => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PLUGIN_BACKEND_INTENT_RESPONSE_INVALID');
  }
  return value as PluginBackendAppIntentArtifact;
};

const intentArtifactBytes = (value: unknown): Uint8Array => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PLUGIN_BACKEND_INTENT_RESPONSE_INVALID');
  }
  const dataBase64 = (value as Record<string, unknown>).dataBase64;
  if (typeof dataBase64 !== 'string') throw new Error('PLUGIN_BACKEND_INTENT_RESPONSE_INVALID');
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.byteLength > PLUGIN_APP_INTENT_ARTIFACT_CHUNK_BYTES) {
    throw new Error('PLUGIN_BACKEND_INTENT_RESPONSE_INVALID');
  }
  return bytes;
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
  intents: Object.freeze({
    create: async (request: Parameters<PluginBackendSdkV1['intents']['create']>[0]) => {
      const { receiverAppId, intentId, input, artifactRefs = [], confirmed } = request;
      return intentReceipt(
        await intentRequest({ kind: 'intent.create', receiverAppId, intentId, input, artifactRefs, confirmed }),
      );
    },
    listReceived: async (limit?: number) => {
      const result = await intentRequest({
        kind: 'intent.listReceived',
        ...(limit === undefined ? {} : { limit }),
      });
      if (!Array.isArray(result)) throw new Error('PLUGIN_BACKEND_INTENT_RESPONSE_INVALID');
      return result.map(intentReceipt);
    },
    revoke: async (receiptId: string) => {
      await intentRequest({ kind: 'intent.revoke', receiptId });
    },
    artifacts: Object.freeze({
      get: async (receiptId: string, artifactId: string) =>
        intentArtifact(await intentRequest({ kind: 'intent.artifact.get', receiptId, artifactId })),
      readRange: async (receiptId: string, artifactId: string, start: number, endInclusive: number) => {
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(endInclusive) ||
          start < 0 ||
          endInclusive < start ||
          endInclusive - start + 1 > PLUGIN_APP_INTENT_ARTIFACT_CHUNK_BYTES
        ) {
          throw new Error('PLUGIN_BACKEND_INTENT_RANGE_INVALID');
        }
        return intentArtifactBytes(
          await intentRequest({ kind: 'intent.artifact.read', receiptId, artifactId, start, endInclusive }),
        );
      },
    }),
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
        message = decodeHostMessage(JSON.parse(line) as unknown);
      } catch {
        throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
      }
      if (message.kind === 'storage.result' || message.kind === 'intent.result') {
        const pending = (message.kind === 'storage.result' ? pendingStorage : pendingIntents).get(message.requestId);
        if (!pending) return;
        (message.kind === 'storage.result' ? pendingStorage : pendingIntents).delete(message.requestId);
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
