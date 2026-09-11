import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import semver from 'semver';
import type { Scope } from '../../../modules/agent/agent.types';
import type { AppStoragePort } from '../../../modules/agent/host/app-storage.port';
import type { AppStorageSnapshot } from '../../../modules/agent/host/app-storage-snapshot.port';
import type {
  PluginBackendRuntimeHealth,
  PluginBackendRuntimePort,
  PluginBackendRuntimeReconcileTarget,
} from '../../../modules/agent/host/plugin-backend-runtime.port';
import type { PluginVersionRecord } from '../../../modules/agent/host/plugin-install.repository.port';
import type { PLUGIN_BACKEND_PROTOCOL_VERSION as PluginBackendProtocolVersion } from '../../../modules/agent/host/plugin-sdk.types';

const MAX_PROTOCOL_BYTES = 20 * 1024 * 1024;
const CONTROL_TIMEOUT_MS = 30_000;
const PLUGIN_BACKEND_PROTOCOL_VERSION: typeof PluginBackendProtocolVersion = 1;
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]{1,128}$/;
const MINIMUM_BUBBLEWRAP_VERSION = '0.12.0';

type StorageRequest =
  | { kind: 'storage.get'; requestId: number; key: string }
  | { kind: 'storage.put'; requestId: number; key: string; value: unknown; expectedVersion: number | null }
  | { kind: 'storage.delete'; requestId: number; key: string; expectedVersion: number };

type LifecycleResult =
  | { kind: 'lifecycle.result'; requestId: number; ok: true; value: unknown }
  | { kind: 'lifecycle.result'; requestId: number; ok: false; error: string };

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
    let message: { kind?: unknown; requestId?: unknown; [key: string]: unknown };
    try {
      message = JSON.parse(line) as { kind?: unknown; requestId?: unknown; [key: string]: unknown };
    } catch {
      this.failAll(new Error('PLUGIN_BACKEND_PROTOCOL_INVALID'));
      this.child.kill('SIGKILL');
      return;
    }
    if (message.kind === 'runtime.ready') {
      if (message.protocolVersion !== PLUGIN_BACKEND_PROTOCOL_VERSION || message.sdkVersion !== this.sdkVersion) {
        this.failAll(new Error('PLUGIN_BACKEND_PROTOCOL_VERSION_MISMATCH'));
        this.child.kill('SIGKILL');
        return;
      }
      this.readyResolve();
      return;
    }
    if (message.kind === 'lifecycle.result') {
      this.resolveLifecycle(message as LifecycleResult);
      return;
    }
    if (message.kind === 'storage.get' || message.kind === 'storage.put' || message.kind === 'storage.delete') {
      await this.handleStorage(message as StorageRequest);
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
    private readonly sandboxBinary = process.env.NEXUS_PLUGIN_SANDBOX_BIN?.trim() || 'bwrap',
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
    if (!this.sandboxAvailable()) throw new Error('PLUGIN_BACKEND_SANDBOX_UNAVAILABLE');
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
    const worker = path.join(__dirname, 'plugin-backend-sandbox.worker.js');
    if (!fs.existsSync(worker)) throw new Error('PLUGIN_BACKEND_SANDBOX_UNAVAILABLE');
    const systemBindings = ['/bin', '/usr', '/lib', '/sbin', '/etc'].filter((source) => fs.existsSync(source));
    const args = [
      '--die-with-parent',
      '--new-session',
      '--unshare-pid',
      '--unshare-ipc',
      '--unshare-uts',
      '--unshare-net',
      ...systemBindings.flatMap((source) => ['--ro-bind', source, source]),
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/tmp',
      '--dir',
      '/nexus',
      '--ro-bind',
      worker,
      '/nexus/plugin-backend-sandbox.worker.js',
      '--dir',
      '/plugin',
      '--ro-bind',
      pluginRoot,
      '/plugin',
      '--chdir',
      '/plugin',
      '--clearenv',
      '--setenv',
      'PATH',
      '/usr/local/bin:/usr/bin:/bin',
      '--setenv',
      'HOME',
      '/tmp',
      '--setenv',
      'NEXUS_PLUGIN_USER_ID',
      String(scope.userId),
      '--setenv',
      'NEXUS_PLUGIN_APP_ID',
      plugin.appId,
      '--setenv',
      'NEXUS_PLUGIN_VERSION',
      plugin.version,
      '--setenv',
      'NEXUS_PLUGIN_SDK_VERSION',
      plugin.manifest.sdkVersion,
      '--setenv',
      'NEXUS_PLUGIN_PROTOCOL_VERSION',
      String(PLUGIN_BACKEND_PROTOCOL_VERSION),
      '--setenv',
      'NEXUS_PLUGIN_BACKEND_ENTRY',
      plugin.backendEntry,
      '--',
      process.execPath,
      '/nexus/plugin-backend-sandbox.worker.js',
    ];
    const child = spawn(this.sandboxBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' },
    });
    return new BackendPluginProcess(
      child,
      { userId: scope.userId, appId: plugin.appId },
      this.storage,
      plugin.manifest.sdkVersion,
    );
  }

  private sandboxAvailable(): boolean {
    const result = spawnSync(this.sandboxBinary, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    });
    if (result.error || result.status !== 0) return false;
    const match = String(result.stdout ?? '')
      .trim()
      .match(/^bubblewrap\s+(\d+\.\d+\.\d+)$/);
    const version = match?.[1];
    return Boolean(version && semver.valid(version) && semver.gte(version, MINIMUM_BUBBLEWRAP_VERSION));
  }

  private instanceKey(scope: Scope, plugin: PluginVersionRecord): string {
    return `${scope.userId}:${plugin.appId}:${plugin.version}`;
  }

  private safe(value: string): string {
    if (!SAFE_SEGMENT.test(value)) throw new Error('PLUGIN_BACKEND_IDENTITY_INVALID');
    return value;
  }
}
