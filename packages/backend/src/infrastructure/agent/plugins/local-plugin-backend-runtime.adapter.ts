import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { JsonValue, Scope } from '../../../modules/agent/agent.types';
import type { AppStoragePort } from '../../../modules/agent/host/app-storage.port';
import type { AppStorageSnapshot } from '../../../modules/agent/host/app-storage-snapshot.port';
import { assertPluginOwnedAppStorageKey } from '../../../modules/agent/host/app-storage-ownership';
import type { AppIntentService } from '../../../modules/agent/host/app-intent.service';
import type {
  PluginBackendRuntimeHealth,
  PluginBackendRuntimePort,
  PluginBackendRuntimeReconcileTarget,
} from '../../../modules/agent/host/plugin-backend-runtime.port';
import type { PluginVersionRecord } from '../../../modules/agent/host/plugin-install.repository.port';
import {
  PLUGIN_APP_INTENT_ARTIFACT_CHUNK_BYTES,
  type PLUGIN_BACKEND_PROTOCOL_VERSION as PluginBackendProtocolVersion,
} from '../../../modules/agent/host/plugin-sdk.types';

const MAX_PROTOCOL_BYTES = 20 * 1024 * 1024;
const CONTROL_TIMEOUT_MS = 30_000;
const PLUGIN_BACKEND_PROTOCOL_VERSION: typeof PluginBackendProtocolVersion = 1;
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]{1,128}$/;

type StorageRequest =
  | { kind: 'storage.get'; requestId: number; key: string }
  | { kind: 'storage.put'; requestId: number; key: string; value: unknown; expectedVersion: number | null }
  | { kind: 'storage.delete'; requestId: number; key: string; expectedVersion: number };

type IntentRequest =
  | {
      kind: 'intent.create';
      requestId: number;
      receiverAppId: string;
      intentId: string;
      input: JsonValue;
      artifactRefs: Array<{ appId: string; id: string }>;
      confirmed: true;
    }
  | { kind: 'intent.listReceived'; requestId: number; limit?: number }
  | { kind: 'intent.revoke'; requestId: number; receiptId: string }
  | { kind: 'intent.artifact.get'; requestId: number; receiptId: string; artifactId: string }
  | {
      kind: 'intent.artifact.read';
      requestId: number;
      receiptId: string;
      artifactId: string;
      start: number;
      endInclusive: number;
    };

type LifecycleResult =
  | { kind: 'lifecycle.result'; requestId: number; ok: true; value: unknown }
  | { kind: 'lifecycle.result'; requestId: number; ok: false; error: string };

type ProtocolRecord = Record<string, unknown>;

const protocolRecord = (value: unknown): ProtocolRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
  return value as ProtocolRecord;
};

const protocolRequestId = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
  return Number(value);
};

const protocolString = (value: unknown, maxBytes = 4096): string => {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes)
    throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
  return value;
};

const protocolJsonValue = (value: unknown, depth = 0): JsonValue => {
  if (depth > 64) throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return protocolString(value, MAX_PROTOCOL_BYTES);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 16_384) throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
    return value.map((item) => protocolJsonValue(item, depth + 1));
  }
  const record = protocolRecord(value);
  const entries = Object.entries(record);
  if (entries.length > 16_384) throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
  return Object.fromEntries(entries.map(([key, item]) => [key, protocolJsonValue(item, depth + 1)]));
};

const requireProtocolKeys = (record: ProtocolRecord, allowed: readonly string[]): void => {
  const keys = new Set(['kind', 'requestId', ...allowed]);
  if (Object.keys(record).some((key) => !keys.has(key))) throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
};

const decodeLifecycleResult = (record: ProtocolRecord): LifecycleResult => {
  const requestId = protocolRequestId(record.requestId);
  if (record.ok === true) return { kind: 'lifecycle.result', requestId, ok: true, value: record.value };
  if (record.ok === false) {
    return { kind: 'lifecycle.result', requestId, ok: false, error: protocolString(record.error, 1024) };
  }
  throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
};

const decodeStorageRequest = (record: ProtocolRecord): StorageRequest => {
  const requestId = protocolRequestId(record.requestId);
  const key = protocolString(record.key, 1024);
  switch (record.kind) {
    case 'storage.get':
      return { kind: record.kind, requestId, key };
    case 'storage.put':
      if (
        record.expectedVersion !== null &&
        (!Number.isSafeInteger(record.expectedVersion) || Number(record.expectedVersion) < 1)
      )
        throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
      return {
        kind: record.kind,
        requestId,
        key,
        value: protocolJsonValue(record.value),
        expectedVersion: record.expectedVersion === null ? null : Number(record.expectedVersion),
      };
    case 'storage.delete':
      return {
        kind: record.kind,
        requestId,
        key,
        expectedVersion: protocolRequestId(record.expectedVersion),
      };
    default:
      throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
  }
};

const decodeIntentRequest = (record: ProtocolRecord): IntentRequest => {
  const requestId = protocolRequestId(record.requestId);
  switch (record.kind) {
    case 'intent.create': {
      requireProtocolKeys(record, ['receiverAppId', 'intentId', 'input', 'artifactRefs', 'confirmed']);
      if (record.confirmed !== true || !Array.isArray(record.artifactRefs) || record.artifactRefs.length > 16) {
        throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
      }
      const artifactRefs = record.artifactRefs.map((value) => {
        const ref = protocolRecord(value);
        if (Object.keys(ref).some((key) => !['appId', 'id'].includes(key))) {
          throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
        }
        return { appId: protocolString(ref.appId, 256), id: protocolString(ref.id, 256) };
      });
      return {
        kind: record.kind,
        requestId,
        receiverAppId: protocolString(record.receiverAppId, 256),
        intentId: protocolString(record.intentId, 256),
        input: protocolJsonValue(record.input),
        artifactRefs,
        confirmed: true,
      };
    }
    case 'intent.listReceived': {
      requireProtocolKeys(record, ['limit']);
      if (
        record.limit !== undefined &&
        (!Number.isSafeInteger(record.limit) || Number(record.limit) < 1 || Number(record.limit) > 100)
      ) {
        throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
      }
      return {
        kind: record.kind,
        requestId,
        ...(record.limit === undefined ? {} : { limit: Number(record.limit) }),
      };
    }
    case 'intent.revoke':
      requireProtocolKeys(record, ['receiptId']);
      return { kind: record.kind, requestId, receiptId: protocolString(record.receiptId, 128) };
    case 'intent.artifact.get':
      requireProtocolKeys(record, ['receiptId', 'artifactId']);
      return {
        kind: record.kind,
        requestId,
        receiptId: protocolString(record.receiptId, 128),
        artifactId: protocolString(record.artifactId, 256),
      };
    case 'intent.artifact.read': {
      requireProtocolKeys(record, ['receiptId', 'artifactId', 'start', 'endInclusive']);
      if (
        !Number.isSafeInteger(record.start) ||
        !Number.isSafeInteger(record.endInclusive) ||
        Number(record.start) < 0 ||
        Number(record.endInclusive) < Number(record.start) ||
        Number(record.endInclusive) - Number(record.start) + 1 > PLUGIN_APP_INTENT_ARTIFACT_CHUNK_BYTES
      ) {
        throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
      }
      return {
        kind: record.kind,
        requestId,
        receiptId: protocolString(record.receiptId, 128),
        artifactId: protocolString(record.artifactId, 256),
        start: Number(record.start),
        endInclusive: Number(record.endInclusive),
      };
    }
    default:
      throw new Error('PLUGIN_BACKEND_PROTOCOL_INVALID');
  }
};

class BackendPluginProcess {
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }
  >();
  private sequence = 0;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly scope: Scope,
    private readonly storage: AppStoragePort,
    private readonly appIntents: AppIntentService,
    private readonly sdkVersion: string,
  ) {
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => void this.handleLine(line));
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8192);
    });
    child.once('error', (error) => this.failAll(error));
    child.once('exit', (code, signal) => {
      this.failAll(new Error(`PLUGIN_BACKEND_EXITED:${code ?? 'null'}:${signal ?? 'none'}:${stderr.slice(-1024)}`));
    });
  }

  request(kind: 'lifecycle.activate' | 'lifecycle.health' | 'lifecycle.dispose'): Promise<unknown>;
  request(kind: 'lifecycle.quiesce', payload: { deadlineUnixSeconds: number }): Promise<unknown>;
  request(
    kind: 'lifecycle.migrate',
    payload: { fromVersion: string | null; storage: AppStorageSnapshot },
  ): Promise<unknown>;
  request(kind: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (this.child.killed || !this.child.stdin.writable) throw new Error('PLUGIN_BACKEND_NOT_RUNNING');
    const requestId = ++this.sequence;
    const encoded = JSON.stringify({ kind, requestId, ...payload });
    if (Buffer.byteLength(encoded, 'utf8') > MAX_PROTOCOL_BYTES) throw new Error('PLUGIN_BACKEND_REQUEST_TOO_LARGE');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('PLUGIN_BACKEND_TIMEOUT'));
      }, CONTROL_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(requestId, { resolve, reject, timer });
      this.child.stdin.write(`${encoded}\n`);
    });
  }

  async close(): Promise<void> {
    if (!this.child.killed && this.child.stdin.writable) {
      await this.request('lifecycle.dispose').catch(() => undefined);
    }
    this.child.kill('SIGTERM');
  }

  private async handleLine(line: string): Promise<void> {
    if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_BYTES) {
      this.failAll(new Error('PLUGIN_BACKEND_RESPONSE_TOO_LARGE'));
      this.child.kill('SIGKILL');
      return;
    }
    let message: ProtocolRecord;
    try {
      message = protocolRecord(JSON.parse(line) as unknown);
    } catch {
      this.failAll(new Error('PLUGIN_BACKEND_PROTOCOL_INVALID'));
      this.child.kill('SIGKILL');
      return;
    }
    if (message.kind === 'runtime.ready') {
      if (
        message.protocolVersion !== PLUGIN_BACKEND_PROTOCOL_VERSION ||
        protocolString(message.sdkVersion, 128) !== this.sdkVersion
      ) {
        this.failAll(new Error('PLUGIN_BACKEND_PROTOCOL_VERSION_MISMATCH'));
        this.child.kill('SIGKILL');
        return;
      }
      this.readyResolve();
      return;
    }
    if (message.kind === 'lifecycle.result') {
      this.resolveLifecycle(decodeLifecycleResult(message));
      return;
    }
    if (message.kind === 'storage.get' || message.kind === 'storage.put' || message.kind === 'storage.delete') {
      await this.handleStorage(decodeStorageRequest(message));
      return;
    }
    if (
      message.kind === 'intent.create' ||
      message.kind === 'intent.listReceived' ||
      message.kind === 'intent.revoke' ||
      message.kind === 'intent.artifact.get' ||
      message.kind === 'intent.artifact.read'
    ) {
      await this.handleIntent(decodeIntentRequest(message));
      return;
    }
    this.failAll(new Error('PLUGIN_BACKEND_PROTOCOL_INVALID'));
    this.child.kill('SIGKILL');
  }

  private resolveLifecycle(message: LifecycleResult): void {
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(new Error(`PLUGIN_BACKEND_ERROR:${message.error.slice(0, 1024)}`));
  }

  private async handleStorage(message: StorageRequest): Promise<void> {
    try {
      assertPluginOwnedAppStorageKey(message.key);
      let value: unknown;
      if (message.kind === 'storage.get') {
        value = await this.storage.get(this.scope, message.key);
      } else if (message.kind === 'storage.put') {
        if (
          message.expectedVersion !== null &&
          (!Number.isSafeInteger(message.expectedVersion) || message.expectedVersion < 1)
        ) {
          throw new Error('APP_STORAGE_VERSION_INVALID');
        }
        value = await this.storage.put(this.scope, message.key, message.value as never, message.expectedVersion);
      } else {
        if (!Number.isSafeInteger(message.expectedVersion) || message.expectedVersion < 1) {
          throw new Error('APP_STORAGE_VERSION_INVALID');
        }
        value = await this.storage.delete(this.scope, message.key, message.expectedVersion);
      }
      this.sendStorageResult(message.requestId, true, value);
    } catch (error) {
      this.sendStorageResult(message.requestId, false, error instanceof Error ? error.message : 'APP_STORAGE_FAILED');
    }
  }

  private sendStorageResult(requestId: number, ok: boolean, value: unknown): void {
    const message = ok
      ? { kind: 'storage.result', requestId, ok: true, value }
      : { kind: 'storage.result', requestId, ok: false, error: String(value).slice(0, 1024) };
    const encoded = JSON.stringify(message);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_PROTOCOL_BYTES) throw new Error('PLUGIN_BACKEND_RESPONSE_TOO_LARGE');
    this.child.stdin.write(`${encoded}\n`);
  }

  private async handleIntent(message: IntentRequest): Promise<void> {
    try {
      let value: unknown;
      switch (message.kind) {
        case 'intent.create':
          value = await this.appIntents.createConfirmed(this.scope, {
            receiverAppId: message.receiverAppId,
            intentId: message.intentId,
            input: message.input,
            artifactRefs: message.artifactRefs,
            confirmed: true,
          });
          break;
        case 'intent.listReceived':
          value = await this.appIntents.listReceived(this.scope, message.limit);
          break;
        case 'intent.revoke':
          await this.appIntents.revoke(this.scope, message.receiptId);
          value = { revoked: true };
          break;
        case 'intent.artifact.get':
          value = await this.appIntents.getReceivedArtifact(this.scope, message.receiptId, message.artifactId);
          break;
        case 'intent.artifact.read': {
          const chunks: Buffer[] = [];
          let total = 0;
          const expectedBytes = message.endInclusive - message.start + 1;
          const read = await this.appIntents.readReceivedArtifact(this.scope, message.receiptId, message.artifactId, {
            start: message.start,
            endInclusive: message.endInclusive,
          });
          for await (const chunk of read.source) {
            const bytes = Buffer.from(chunk);
            total += bytes.byteLength;
            if (total > expectedBytes || total > PLUGIN_APP_INTENT_ARTIFACT_CHUNK_BYTES) {
              throw new Error('APP_INTENT_ARTIFACT_RANGE_INVALID');
            }
            chunks.push(bytes);
          }
          if (total !== expectedBytes) throw new Error('APP_INTENT_ARTIFACT_RANGE_INVALID');
          value = { dataBase64: Buffer.concat(chunks, total).toString('base64') };
          break;
        }
      }
      this.sendIntentResult(message.requestId, true, value);
    } catch (error) {
      this.sendIntentResult(message.requestId, false, error instanceof Error ? error.message : 'APP_INTENT_FAILED');
    }
  }

  private sendIntentResult(requestId: number, ok: boolean, value: unknown): void {
    const message = ok
      ? { kind: 'intent.result', requestId, ok: true, value }
      : { kind: 'intent.result', requestId, ok: false, error: String(value).slice(0, 1024) };
    const encoded = JSON.stringify(message);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_PROTOCOL_BYTES) throw new Error('PLUGIN_BACKEND_RESPONSE_TOO_LARGE');
    this.child.stdin.write(`${encoded}\n`);
  }

  private failAll(error: Error): void {
    this.readyReject(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export class LocalPluginBackendRuntimeAdapter implements PluginBackendRuntimePort {
  private readonly instances = new Map<string, BackendPluginProcess>();

  constructor(
    private readonly dataDirectory: string,
    private readonly storage: AppStoragePort,
    private readonly appIntents: AppIntentService,
  ) {}

  async reconcileUser(userId: number, targets: readonly PluginBackendRuntimeReconcileTarget[]): Promise<void> {
    const expected = new Set(
      targets
        .filter((target) => target.enabled && Boolean(target.plugin.backendEntry))
        .map((target) => this.instanceKey(target.scope, target.plugin)),
    );
    for (const [key, instance] of this.instances) {
      if (!key.startsWith(`${userId}:`) || expected.has(key)) continue;
      await instance.close().catch(() => undefined);
      this.instances.delete(key);
    }
  }

  async health(scope: Scope, plugin: PluginVersionRecord): Promise<PluginBackendRuntimeHealth> {
    if (!plugin.backendEntry) return { available: true, reason: null };
    const instance = this.instances.get(this.instanceKey(scope, plugin));
    if (!instance) return { available: false, reason: 'PLUGIN_BACKEND_NOT_RUNNING' };
    try {
      const result = await instance.request('lifecycle.health');
      if (!result || typeof result !== 'object' || Array.isArray(result)) return { available: true, reason: null };
      const value = result as { available?: unknown; ok?: unknown; reason?: unknown };
      const available =
        typeof value.available === 'boolean' ? value.available : typeof value.ok === 'boolean' ? value.ok : true;
      return {
        available,
        reason: available ? null : typeof value.reason === 'string' ? value.reason.slice(0, 1024) : 'PLUGIN_UNHEALTHY',
      };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message.slice(0, 1024) : 'PLUGIN_BACKEND_UNAVAILABLE',
      };
    }
  }

  async activate(scope: Scope, plugin: PluginVersionRecord): Promise<void> {
    if (!plugin.backendEntry) return;
    const key = this.instanceKey(scope, plugin);
    const current = this.instances.get(key);
    if (current) {
      const health = await this.health(scope, plugin);
      if (health.available) return;
      await current.close().catch(() => undefined);
      this.instances.delete(key);
    }
    const instance = this.start(scope, plugin);
    this.instances.set(key, instance);
    try {
      await instance.ready;
      await instance.request('lifecycle.activate');
    } catch (error) {
      await instance.close().catch(() => undefined);
      this.instances.delete(key);
      throw error;
    }
  }

  async quiesce(scope: Scope, plugin: PluginVersionRecord, deadlineUnixSeconds: number): Promise<void> {
    const instance = this.instances.get(this.instanceKey(scope, plugin));
    if (!instance) return;
    await instance.request('lifecycle.quiesce', { deadlineUnixSeconds });
  }

  async dispose(scope: Scope, plugin: PluginVersionRecord): Promise<void> {
    const key = this.instanceKey(scope, plugin);
    const instance = this.instances.get(key);
    if (!instance) return;
    this.instances.delete(key);
    await instance.close();
  }

  async migrate(
    scope: Scope,
    fromVersion: string | null,
    plugin: PluginVersionRecord,
    storage: AppStorageSnapshot,
  ): Promise<AppStorageSnapshot> {
    if (!plugin.backendEntry) return storage;
    const instance = this.start(scope, plugin);
    try {
      await instance.ready;
      return (await instance.request('lifecycle.migrate', { fromVersion, storage })) as AppStorageSnapshot;
    } finally {
      await instance.close().catch(() => undefined);
    }
  }

  private start(scope: Scope, plugin: PluginVersionRecord): BackendPluginProcess {
    if (!plugin.backendEntry) throw new Error('PLUGIN_BACKEND_ENTRY_MISSING');
    const pluginRoot = path.resolve(
      this.dataDirectory,
      'agent',
      'plugins',
      this.safe(plugin.appId),
      'versions',
      this.safe(plugin.version),
    );
    const marker = path.join(pluginRoot, '.nexus-package-hash');
    if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim() !== plugin.packageHash) {
      throw new Error('PLUGIN_BACKEND_SOURCE_MISMATCH');
    }
    const worker = path.join(__dirname, 'plugin-backend-runtime.worker.js');
    if (!fs.existsSync(worker)) throw new Error('PLUGIN_BACKEND_RUNTIME_UNAVAILABLE');
    const args = ['--permission', `--allow-fs-read=${pluginRoot}`, `--allow-fs-read=${worker}`, worker];
    const child = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: pluginRoot,
      env: {
        NEXUS_PLUGIN_USER_ID: String(scope.userId),
        NEXUS_PLUGIN_APP_ID: plugin.appId,
        NEXUS_PLUGIN_VERSION: plugin.version,
        NEXUS_PLUGIN_SDK_VERSION: plugin.manifest.sdkVersion,
        NEXUS_PLUGIN_PROTOCOL_VERSION: String(PLUGIN_BACKEND_PROTOCOL_VERSION),
        NEXUS_PLUGIN_BACKEND_ENTRY: plugin.backendEntry,
        NEXUS_PLUGIN_ROOT: pluginRoot,
      },
    });
    return new BackendPluginProcess(
      child,
      { userId: scope.userId, appId: plugin.appId },
      this.storage,
      this.appIntents,
      plugin.manifest.sdkVersion,
    );
  }

  private instanceKey(scope: Scope, plugin: PluginVersionRecord): string {
    return `${scope.userId}:${plugin.appId}:${plugin.version}`;
  }

  private safe(value: string): string {
    if (!SAFE_SEGMENT.test(value)) throw new Error('PLUGIN_BACKEND_IDENTITY_INVALID');
    return value;
  }
}
