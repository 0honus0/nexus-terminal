import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { valid as validSemver } from 'semver';
import {
  decodePluginJson,
  encodePluginBinaryFrame,
  encodePluginJsonFrame,
  PluginIpcDecoder,
  type PluginIpcFrame,
  writePluginFrame,
} from '../plugin-ipc';
import type { EnvironmentRecord, PluginRunnerTarget } from '../types';
import { PLUGIN_RUNNER_PROTOCOL_VERSION } from '../plugin-sdk.types';
import {
  WorkspaceBroker,
  type WorkspaceAccessTarget,
  type WorkspaceGrant,
  type WorkspaceReadHandle,
} from './workspace-broker';

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]{1,128}$/;

type WorkspaceRequest =
  | { kind: 'workspace.read'; targetPluginId: string; path: string }
  | { kind: 'workspace.write'; targetPluginId: string; path: string }
  | { kind: 'workspace.list'; targetPluginId: string; path: string }
  | { kind: 'workspace.stat'; targetPluginId: string; path: string }
  | { kind: 'workspace.mkdir'; targetPluginId: string; path: string }
  | { kind: 'workspace.rename'; targetPluginId: string; path: string; destinationPath: string }
  | { kind: 'workspace.remove'; targetPluginId: string; path: string };

const workspaceRequest = (message: Record<string, unknown>): WorkspaceRequest => {
  const kind = message.kind;
  if (
    ![
      'workspace.read',
      'workspace.write',
      'workspace.list',
      'workspace.stat',
      'workspace.mkdir',
      'workspace.rename',
      'workspace.remove',
    ].includes(String(kind)) ||
    typeof message.targetPluginId !== 'string' ||
    typeof message.path !== 'string' ||
    (kind === 'workspace.rename' && typeof message.destinationPath !== 'string')
  ) {
    throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
  }
  return message as WorkspaceRequest;
};

type LifecycleResult =
  { kind: 'lifecycle.result'; ok: true; value: unknown } | { kind: 'lifecycle.result'; ok: false; error: string };

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface PendingWorkspaceWrite {
  target: WorkspaceAccessTarget;
  timer: NodeJS.Timeout;
}

class RunnerPluginProcess {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly pendingWorkspaceWrites = new Map<number, PendingWorkspaceWrite>();
  private readonly decoder = new PluginIpcDecoder();
  private frameQueue = Promise.resolve();
  private sequence = 0;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly environmentId: string,
    private readonly generation: number,
    private readonly callerPluginId: string,
    private readonly workspaces: WorkspaceBroker,
    private readonly sdkVersion: string,
    private readonly protocolVersion: typeof PLUGIN_RUNNER_PROTOCOL_VERSION,
  ) {
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const frame of this.decoder.push(chunk)) {
          this.frameQueue = this.frameQueue.then(() => this.handleFrame(frame));
        }
        this.frameQueue = this.frameQueue.catch((error) => this.protocolFailure(error));
      } catch (error) {
        this.protocolFailure(error);
      }
    });
    child.stdout.once('end', () => {
      try {
        this.decoder.end();
      } catch (error) {
        this.protocolFailure(error);
      }
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8192);
    });
    child.once('error', (error) => this.failAll(error));
    child.once('exit', (code, signal) =>
      this.failAll(new Error(`PLUGIN_RUNNER_EXITED:${code ?? 'null'}:${signal ?? 'none'}:${stderr.slice(-1024)}`)),
    );
  }

  request(kind: 'lifecycle.activate' | 'lifecycle.health' | 'lifecycle.dispose'): Promise<unknown>;
  request(kind: 'lifecycle.quiesce', payload: { deadlineUnixSeconds: number }): Promise<unknown>;
  request(kind: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (this.child.killed || !this.child.stdin.writable) throw new Error('PLUGIN_RUNNER_NOT_RUNNING');
    const requestId = this.nextRequestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('PLUGIN_RUNNER_TIMEOUT'));
      }, 30_000);
      timer.unref?.();
      this.pending.set(requestId, { resolve, reject, timer });
      void writePluginFrame(this.child.stdin, encodePluginJsonFrame(requestId, { kind, ...payload })).catch((error) => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        clearTimeout(pending.timer);
        pending.reject(error instanceof Error ? error : new Error('PLUGIN_RUNNER_NOT_RUNNING'));
      });
    });
  }

  async close(): Promise<void> {
    if (!this.child.killed && this.child.stdin.writable) await this.request('lifecycle.dispose').catch(() => undefined);
    this.child.kill('SIGTERM');
  }

  private async handleFrame(frame: PluginIpcFrame): Promise<void> {
    if (frame.type === 'binary') {
      await this.handleWorkspaceBinary(frame.requestId, frame.payload);
      return;
    }
    const message = decodePluginJson(frame);
    if (message.kind === 'runtime.ready') {
      if (frame.requestId !== 0) throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
      if (message.protocolVersion !== this.protocolVersion || message.sdkVersion !== this.sdkVersion) {
        this.failAll(new Error('PLUGIN_RUNNER_PROTOCOL_VERSION_MISMATCH'));
        this.child.kill('SIGKILL');
        return;
      }
      this.readyResolve();
      return;
    }
    if (message.kind === 'lifecycle.result') {
      const result = message as LifecycleResult;
      const pending = this.pending.get(frame.requestId);
      if (!pending) return;
      this.pending.delete(frame.requestId);
      clearTimeout(pending.timer);
      if (result.ok) pending.resolve(result.value);
      else if (typeof result.error === 'string')
        pending.reject(new Error(`PLUGIN_RUNNER_ERROR:${result.error.slice(0, 1024)}`));
      else pending.reject(new Error('PLUGIN_RUNNER_PROTOCOL_INVALID'));
      return;
    }
    if (
      message.kind === 'workspace.read' ||
      message.kind === 'workspace.write' ||
      message.kind === 'workspace.list' ||
      message.kind === 'workspace.stat' ||
      message.kind === 'workspace.mkdir' ||
      message.kind === 'workspace.rename' ||
      message.kind === 'workspace.remove'
    ) {
      if (frame.requestId === 0) throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
      await this.handleWorkspace(frame.requestId, workspaceRequest(message));
      return;
    }
    throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
  }

  private async handleWorkspace(requestId: number, message: WorkspaceRequest): Promise<void> {
    try {
      const target: WorkspaceAccessTarget = {
        environmentId: this.environmentId,
        generation: this.generation,
        callerPluginId: this.callerPluginId,
        targetPluginId: message.targetPluginId,
        path: message.path,
      };
      let value: unknown;
      if (message.kind === 'workspace.read') {
        await writePluginFrame(this.child.stdin, encodePluginBinaryFrame(requestId, this.workspaces.read(target)));
        return;
      } else if (message.kind === 'workspace.write') {
        if (this.pendingWorkspaceWrites.has(requestId)) throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
        const timer = setTimeout(() => {
          this.pendingWorkspaceWrites.delete(requestId);
          void this.sendWorkspaceResult(requestId, false, 'PLUGIN_RUNNER_TIMEOUT');
        }, 30_000);
        timer.unref?.();
        this.pendingWorkspaceWrites.set(requestId, { target, timer });
        return;
      } else if (message.kind === 'workspace.list') value = this.workspaces.list(target);
      else if (message.kind === 'workspace.stat') value = this.workspaces.stat(target);
      else if (message.kind === 'workspace.mkdir') {
        this.workspaces.mkdir(target);
        value = { created: true };
      } else if (message.kind === 'workspace.rename') {
        this.workspaces.rename(target, message.destinationPath);
        value = { renamed: true };
      } else {
        this.workspaces.remove(target);
        value = { removed: true };
      }
      await this.sendWorkspaceResult(requestId, true, value);
    } catch (error) {
      await this.sendWorkspaceResult(
        requestId,
        false,
        error instanceof Error ? error.message : 'WORKSPACE_ACCESS_FAILED',
      );
    }
  }

  private async handleWorkspaceBinary(requestId: number, payload: Buffer): Promise<void> {
    const pending = this.pendingWorkspaceWrites.get(requestId);
    if (!pending) throw new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
    this.pendingWorkspaceWrites.delete(requestId);
    clearTimeout(pending.timer);
    try {
      this.workspaces.write(pending.target, payload);
      await this.sendWorkspaceResult(requestId, true, { written: payload.byteLength });
    } catch (error) {
      await this.sendWorkspaceResult(
        requestId,
        false,
        error instanceof Error ? error.message : 'WORKSPACE_ACCESS_FAILED',
      );
    }
  }

  private sendWorkspaceResult(requestId: number, ok: boolean, value: unknown): Promise<void> {
    const message = ok
      ? { kind: 'workspace.result', ok: true, value }
      : { kind: 'workspace.result', ok: false, error: String(value).slice(0, 1024) };
    return writePluginFrame(this.child.stdin, encodePluginJsonFrame(requestId, message));
  }

  private nextRequestId(): number {
    this.sequence = this.sequence >= 0xffff_ffff ? 1 : this.sequence + 1;
    if (this.pending.has(this.sequence) || this.pendingWorkspaceWrites.has(this.sequence)) {
      throw new Error('PLUGIN_RUNNER_REQUEST_ID_EXHAUSTED');
    }
    return this.sequence;
  }

  private protocolFailure(error: unknown): void {
    const failure = error instanceof Error ? error : new Error('PLUGIN_RUNNER_PROTOCOL_INVALID');
    this.failAll(failure);
    if (!this.child.killed) this.child.kill('SIGKILL');
  }

  private failAll(error: Error): void {
    this.readyReject(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const pending of this.pendingWorkspaceWrites.values()) clearTimeout(pending.timer);
    this.pendingWorkspaceWrites.clear();
  }
}

export class PluginRunnerRuntime {
  private readonly workspaces: WorkspaceBroker;
  private readonly instances = new Map<string, RunnerPluginProcess>();

  constructor(
    runtimeRoot: string,
    private readonly pluginSourceRoot: string,
    private readonly sandboxBinary = process.env.NEXUS_AGENT_SANDBOX_BIN?.trim() || 'bwrap',
  ) {
    this.workspaces = new WorkspaceBroker(runtimeRoot);
  }

  available(): boolean {
    const result = spawnSync(this.sandboxBinary, ['--version'], { stdio: 'ignore', timeout: 2_000 });
    return !result.error && result.status === 0;
  }

  prepareEnvironment(environment: EnvironmentRecord): void {
    for (const target of environment.runnerPlugins ?? []) {
      this.validateTarget(target);
      this.workspaces.ensurePluginWorkspace(environment.environmentId, environment.generation, target.pluginId);
    }
  }

  async activateEnvironment(environment: EnvironmentRecord): Promise<void> {
    this.prepareEnvironment(environment);
    for (const target of environment.runnerPlugins ?? []) {
      const key = this.key(environment, target.pluginId);
      const existing = this.instances.get(key);
      if (existing) continue;
      const instance = this.start(environment, target);
      this.instances.set(key, instance);
      try {
        await instance.ready;
        await instance.request('lifecycle.activate');
      } catch (error) {
        this.instances.delete(key);
        await instance.close().catch(() => undefined);
        throw error;
      }
    }
  }

  async quiesceEnvironment(environment: EnvironmentRecord, deadlineUnixSeconds: number): Promise<void> {
    for (const target of environment.runnerPlugins ?? []) {
      const instance = this.instances.get(this.key(environment, target.pluginId));
      if (instance) await instance.request('lifecycle.quiesce', { deadlineUnixSeconds });
    }
  }

  async disposeEnvironment(environment: EnvironmentRecord): Promise<void> {
    for (const target of environment.runnerPlugins ?? []) {
      const key = this.key(environment, target.pluginId);
      const instance = this.instances.get(key);
      if (!instance) continue;
      this.instances.delete(key);
      await instance.close().catch(() => undefined);
    }
  }

  replaceWorkspaceGrants(
    environmentId: string,
    generation: number,
    targetPluginId: string,
    grants: readonly Omit<WorkspaceGrant, 'targetPluginId'>[],
  ): void {
    this.workspaces.replaceTargetGrants(environmentId, generation, targetPluginId, grants);
  }

  workspaceGrants(environmentId: string, generation: number, targetPluginId: string): WorkspaceGrant[] {
    return this.workspaces.grantsForTarget(environmentId, generation, targetPluginId);
  }

  openWorkspaceFileRead(
    environmentId: string,
    generation: number,
    targetPluginId: string,
    logicalPath: string,
  ): Promise<WorkspaceReadHandle> {
    return this.workspaces.openRead({
      environmentId,
      generation,
      callerPluginId: targetPluginId,
      targetPluginId,
      path: logicalPath,
    });
  }

  writeWorkspaceFileStream(
    environmentId: string,
    generation: number,
    targetPluginId: string,
    logicalPath: string,
    source: AsyncIterable<Uint8Array>,
    expectedBytes: number,
  ): Promise<void> {
    return this.workspaces.writeStream(
      {
        environmentId,
        generation,
        callerPluginId: targetPluginId,
        targetPluginId,
        path: logicalPath,
      },
      source,
      expectedBytes,
    );
  }

  private start(environment: EnvironmentRecord, target: PluginRunnerTarget): RunnerPluginProcess {
    if (!this.available()) throw new Error('PLUGIN_RUNNER_SANDBOX_UNAVAILABLE');
    this.validateTarget(target);
    const source = path.join(this.pluginSourceRoot, this.safe(target.pluginId), target.version);
    const marker = path.join(source, '.nexus-package-hash');
    if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim() !== target.packageHash) {
      throw new Error('PLUGIN_RUNNER_SOURCE_MISMATCH');
    }
    this.workspaces.ensurePluginWorkspace(environment.environmentId, environment.generation, target.pluginId);
    const worker = path.resolve(__dirname, '../worker/plugin-runner-sandbox.worker.js');
    const systemBindings = ['/bin', '/usr', '/lib', '/sbin', '/etc'].filter((pathValue) => fs.existsSync(pathValue));
    const args = [
      '--die-with-parent',
      '--new-session',
      '--unshare-user',
      '--unshare-pid',
      '--unshare-ipc',
      '--unshare-uts',
      '--unshare-net',
      ...systemBindings.flatMap((sourcePath) => ['--ro-bind', sourcePath, sourcePath]),
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
      '/nexus/plugin-runner-sandbox.worker.js',
      '--dir',
      '/plugin',
      '--ro-bind',
      source,
      '/plugin',
      '--chdir',
      '/tmp',
      '--clearenv',
      '--setenv',
      'PATH',
      '/usr/local/bin:/usr/bin:/bin',
      '--setenv',
      'HOME',
      '/tmp',
      '--setenv',
      'NEXUS_ENVIRONMENT_ID',
      environment.environmentId,
      '--setenv',
      'NEXUS_ENVIRONMENT_GENERATION',
      String(environment.generation),
      '--setenv',
      'NEXUS_PLUGIN_ID',
      target.pluginId,
      '--setenv',
      'NEXUS_PLUGIN_VERSION',
      target.version,
      '--setenv',
      'NEXUS_PLUGIN_SDK_VERSION',
      target.sdkVersion,
      '--setenv',
      'NEXUS_PLUGIN_PROTOCOL_VERSION',
      String(target.protocolVersion),
      '--setenv',
      'NEXUS_PLUGIN_RUNNER_ENTRY',
      target.entry,
      '--',
      process.execPath,
      '/nexus/plugin-runner-sandbox.worker.js',
    ];
    const child = spawn(this.sandboxBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' },
    });
    return new RunnerPluginProcess(
      child,
      environment.environmentId,
      environment.generation,
      target.pluginId,
      this.workspaces,
      target.sdkVersion,
      target.protocolVersion,
    );
  }

  private validateTarget(target: PluginRunnerTarget): void {
    this.safe(target.pluginId);
    if (!validSemver(target.version)) throw new Error('PLUGIN_RUNNER_VERSION_INVALID');
    if (!validSemver(target.sdkVersion)) throw new Error('PLUGIN_RUNNER_SDK_VERSION_INVALID');
    if (target.protocolVersion !== PLUGIN_RUNNER_PROTOCOL_VERSION)
      throw new Error('PLUGIN_RUNNER_PROTOCOL_VERSION_UNSUPPORTED');
    if (!/^[a-f0-9]{64}$/.test(target.packageHash)) throw new Error('PLUGIN_RUNNER_HASH_INVALID');
    if (
      !/^runner\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:m?js|cjs)$/.test(target.entry) ||
      target.entry.includes('..')
    ) {
      throw new Error('PLUGIN_RUNNER_ENTRY_INVALID');
    }
  }

  private key(environment: EnvironmentRecord, pluginId: string): string {
    return `${environment.environmentId}:${environment.generation}:${pluginId}`;
  }

  private safe(value: string): string {
    if (!SAFE_SEGMENT.test(value)) throw new Error('PLUGIN_RUNNER_IDENTITY_INVALID');
    return value;
  }
}
