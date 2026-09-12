import { createHash, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PLUGIN_RUNNER_PROTOCOL_VERSION } from '../plugin-sdk.types';
import type {
  WorkspaceRuntimeCommand,
  WorkspaceProvisionCommand,
  WorkspaceLifecycleCommand,
  WorkspaceJobInput,
  WorkspaceJobRequest,
  WorkspaceRecord,
} from '../types';
import { WorkspaceRuntimeCatalog } from './workspace-runtime-catalog';
import { WorkspaceRuntimeEngine } from './workspace-runtime-engine';
import { RunnerJournal, payloadHash } from './journal';
import { PackInstaller } from './pack-installer';
import { SpaceReporter } from './space-reporter';
import { CleanupPlanner } from './cleanup-planner';
import { PluginRunnerRuntime } from './plugin-runner-runtime';
import { MAX_HOST_WORKSPACE_TRANSFER_BYTES } from './plugin-workspace-store';
import type { AcpProcessRuntime } from './acp-process-runtime';
import type { WorkspaceTerminalRuntime } from './workspace-terminal-runtime';
import type { BrowserTunnelRuntime } from './browser-tunnel-runtime';
import type { WorkspaceBrowserEndpoint } from '../types';
import { runnerLog } from '../logging';

const RUNNER_PROTOCOL_VERSION = '2026-09-13';
const MAX_BODY_BYTES = 256 * 1024;
const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(body));
};

const binary = async (
  response: ServerResponse,
  sizeBytes: number,
  source: AsyncIterable<Uint8Array>,
): Promise<void> => {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/octet-stream');
  response.setHeader('content-length', String(sizeBytes));
  response.setHeader('cache-control', 'no-store');
  await pipeline(Readable.from(source), response);
};

const workspaceContentLength = (request: IncomingMessage): number => {
  if (request.headers['transfer-encoding'] !== undefined) throw new Error('VALIDATION_FAILED');
  const raw = request.headers['content-length'];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new Error('VALIDATION_FAILED');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_HOST_WORKSPACE_TRANSFER_BYTES) {
    throw new Error('PAYLOAD_TOO_LARGE');
  }
  return value;
};

const body = async (request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(bytes);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('VALIDATION_FAILED');
  }
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED');
  return value as Record<string, unknown>;
};

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
};

const SAFE_RUNTIME_RESOURCE_ID = /^[a-z][a-z0-9_.-]{0,127}$/;
const validBrowserUrlPattern = (value: string): boolean => {
  const match = /^(\*|https?|wss?):\/\/(\*\.)?([^/:?#]+)(?::(\d{1,5}))?(\/[^?#]*)?$/.exec(value.trim());
  if (!match) return false;
  const port = match[4];
  if (port && (Number(port) < 1 || Number(port) > 65535)) return false;
  const rawPath = match[5];
  return !rawPath || !rawPath.includes('*') || rawPath.endsWith('*');
};

const validateWorkspaceBindings = (command: WorkspaceProvisionCommand): void => {
  if (!Array.isArray(command.acpProfiles) || command.acpProfiles.length > 16) {
    throw new Error('ACP_PROFILE_INVALID');
  }
  const profileIds = new Set<string>();
  for (const profile of command.acpProfiles) {
    if (
      !profile ||
      !SAFE_RUNTIME_RESOURCE_ID.test(profile.id) ||
      profileIds.has(profile.id) ||
      !Number.isSafeInteger(profile.profileRevision) ||
      profile.profileRevision < 1 ||
      !Array.isArray(profile.argv) ||
      profile.argv.length < 1 ||
      profile.argv.length > 64 ||
      profile.argv.some(
        (arg) => typeof arg !== 'string' || arg.includes('\0') || Buffer.byteLength(arg, 'utf8') > 8192,
      ) ||
      typeof profile.cwd !== 'string' ||
      (profile.cwd !== '/workspace' && !profile.cwd.startsWith('/workspace/')) ||
      profile.cwd.includes('\0') ||
      Buffer.byteLength(profile.cwd, 'utf8') > 4096
    ) {
      throw new Error('ACP_PROFILE_INVALID');
    }
    profileIds.add(profile.id);
  }

  const target = command.browserTarget;
  if (target === null) return;
  if (
    !target ||
    !SAFE_RUNTIME_RESOURCE_ID.test(target.id) ||
    !Number.isSafeInteger(target.profileRevision) ||
    target.profileRevision < 1 ||
    !Array.isArray(target.endpoints) ||
    target.endpoints.length < 1 ||
    target.endpoints.length > 16 ||
    !Array.isArray(target.allowedUrlPatterns) ||
    target.allowedUrlPatterns.length < 1 ||
    target.allowedUrlPatterns.length > 128
  ) {
    throw new Error('BROWSER_TARGET_INVALID');
  }
  const patterns = new Set<string>();
  for (const pattern of target.allowedUrlPatterns) {
    if (
      typeof pattern !== 'string' ||
      pattern.length > 2048 ||
      patterns.has(pattern) ||
      !validBrowserUrlPattern(pattern)
    ) {
      throw new Error('BROWSER_TARGET_INVALID');
    }
    patterns.add(pattern);
  }
  for (const endpoint of target.endpoints) {
    if (
      !endpoint ||
      (endpoint.scope !== 'docker-network' && endpoint.scope !== 'external-network') ||
      (endpoint.via !== 'backend' && endpoint.via !== 'runner') ||
      typeof endpoint.url !== 'string' ||
      !endpoint.url ||
      endpoint.url.length > 4096 ||
      !Number.isSafeInteger(endpoint.priority) ||
      endpoint.priority < 0 ||
      endpoint.priority > 10000 ||
      typeof endpoint.allowPlaintext !== 'boolean' ||
      typeof endpoint.verifyTls !== 'boolean'
    ) {
      throw new Error('BROWSER_ENDPOINT_INVALID');
    }
    let url: URL;
    try {
      url = new URL(endpoint.url);
    } catch {
      throw new Error('BROWSER_ENDPOINT_INVALID');
    }
    if (
      !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      ((url.protocol === 'http:' || url.protocol === 'ws:') && !endpoint.allowPlaintext)
    ) {
      throw new Error('BROWSER_ENDPOINT_INVALID');
    }
  }
};

const equalsToken = (candidate: string, expected: string): boolean => {
  const left = createHash('sha256').update(candidate).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
};

export interface RunnerControllerDependencies {
  token: string;
  catalog: WorkspaceRuntimeCatalog;
  journal: RunnerJournal;
  runtimeEngine: WorkspaceRuntimeEngine;
  installer: PackInstaller;
  storage: SpaceReporter;
  cleanup: CleanupPlanner;
  pluginRunner: PluginRunnerRuntime;
  acpRuntime: AcpProcessRuntime;
  terminalRuntime: WorkspaceTerminalRuntime;
  browserTunnel: BrowserTunnelRuntime;
}

export class RunnerControllerServer {
  constructor(private readonly dependencies: RunnerControllerDependencies) {}

  createServer(): http.Server {
    const server = http.createServer((request, response) => void this.route(request, response));
    server.on('upgrade', (request, socket, head) => this.upgrade(request, socket, head));
    server.on('close', () => {
      this.dependencies.acpRuntime.closeAll();
      this.dependencies.terminalRuntime.closeAll();
      this.dependencies.browserTunnel.closeAll();
    });
    return server;
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    try {
      if (!this.authorized(request)) {
        this.rejectUpgrade(socket, 401, 'UNAUTHORIZED');
        return;
      }
      if (request.headers['x-nexus-agent-protocol'] !== RUNNER_PROTOCOL_VERSION) {
        this.rejectUpgrade(socket, 426, 'RUNNER_PROTOCOL_UNSUPPORTED');
        return;
      }
      const url = new URL(request.url ?? '/', 'http://runner.internal');

      const acp = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/acp\/([^/]+)\/stream$/);
      if (acp) {
        const generation = Number(url.searchParams.get('generation'));
        if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('VALIDATION_FAILED');
        this.dependencies.acpRuntime.handleUpgrade(
          request,
          socket,
          head,
          decodeURIComponent(acp[1]!),
          generation,
          decodeURIComponent(acp[2]!),
        );
        return;
      }

      const terminal = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/terminal\/stream$/);
      if (terminal) {
        const generation = Number(url.searchParams.get('generation'));
        const columns = Number(url.searchParams.get('columns'));
        const rows = Number(url.searchParams.get('rows'));
        if (
          !Number.isSafeInteger(generation) ||
          generation < 1 ||
          !Number.isSafeInteger(columns) ||
          columns < 2 ||
          columns > 1000 ||
          !Number.isSafeInteger(rows) ||
          rows < 1 ||
          rows > 500
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        this.dependencies.terminalRuntime.handleUpgrade(
          request,
          socket,
          head,
          decodeURIComponent(terminal[1]!),
          generation,
          columns,
          rows,
        );
        return;
      }

      if (url.pathname === '/v1/browser/tunnel') {
        const rawEndpoint = request.headers['x-nexus-browser-endpoint'];
        if (typeof rawEndpoint !== 'string' || rawEndpoint.length > 12_000) throw new Error('BROWSER_ENDPOINT_INVALID');
        let endpoint: WorkspaceBrowserEndpoint;
        try {
          endpoint = JSON.parse(Buffer.from(rawEndpoint, 'base64url').toString('utf8')) as WorkspaceBrowserEndpoint;
        } catch {
          throw new Error('BROWSER_ENDPOINT_INVALID');
        }
        const targetId = request.headers['x-nexus-browser-target'];
        const targetRevision = Number(request.headers['x-nexus-browser-revision']);
        if (typeof targetId !== 'string' || !Number.isSafeInteger(targetRevision) || targetRevision < 1) {
          throw new Error('BROWSER_TARGET_INVALID');
        }
        const workspaceId = url.searchParams.get('workspaceId')?.trim() || undefined;
        const generationValue = url.searchParams.get('generation');
        const generation = generationValue === null ? undefined : Number(generationValue);
        if (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 1)) {
          throw new Error('VALIDATION_FAILED');
        }
        this.dependencies.browserTunnel.handleUpgrade(request, socket, head, endpoint, {
          targetId,
          targetRevision,
          ...(workspaceId ? { workspaceId } : {}),
          ...(generation === undefined ? {} : { generation }),
        });
        return;
      }

      this.rejectUpgrade(socket, 404, 'NOT_FOUND');
    } catch (error) {
      this.rejectUpgrade(socket, 400, error instanceof Error ? error.message : 'VALIDATION_FAILED');
    }
  }

  private rejectUpgrade(socket: Duplex, status: number, code: string): void {
    if (socket.destroyed) return;
    const reason =
      status === 401
        ? 'Unauthorized'
        : status === 404
          ? 'Not Found'
          : status === 426
            ? 'Upgrade Required'
            : 'Bad Request';
    socket.end(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n${JSON.stringify({ error: code.slice(0, 128) })}`,
    );
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!this.authorized(request)) {
        json(response, 401, { error: 'UNAUTHORIZED' });
        return;
      }
      if (request.headers['x-nexus-agent-protocol'] !== RUNNER_PROTOCOL_VERSION) {
        json(response, 426, { error: 'RUNNER_PROTOCOL_UNSUPPORTED', expected: RUNNER_PROTOCOL_VERSION });
        return;
      }
      const url = new URL(request.url ?? '/', 'http://runner.internal');
      if (request.method === 'GET' && url.pathname === '/v1/availability') {
        json(response, 200, {
          available: true,
          reason: null,
          mode: 'native',
          isolation: 'logical',
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/catalog') {
        const catalog = this.dependencies.catalog.load();
        const active = this.dependencies.journal
          .workspaces()
          .filter((workspace) => !['deleted', 'failed'].includes(workspace.status));
        const packs = catalog.packs.map((pack) => {
          const contentDigest = pack.contentDigestByArch[process.arch] ?? '';
          const ref = { familyId: pack.familyId, versionId: pack.versionId, contentDigest };
          const supported = Boolean(contentDigest) && pack.supportedArchitectures.includes(process.arch);
          return {
            familyId: pack.familyId,
            versionId: pack.versionId,
            displayName: pack.displayName,
            contentDigest,
            diskBytes: pack.diskBytes,
            status: supported ? pack.status : ('unavailable' as const),
            installed: supported && this.dependencies.installer.installed(ref),
            enabled: supported && pack.status === 'supported',
            inUse:
              supported &&
              active.some((workspace) =>
                workspace.toolchain.some(
                  (candidate) =>
                    candidate.familyId === ref.familyId &&
                    candidate.versionId === ref.versionId &&
                    candidate.contentDigest === ref.contentDigest,
                ),
              ),
          };
        });
        json(response, 200, {
          revision: catalog.revision,
          runtimeDigest: catalog.runtimeDigest,
          recipes: catalog.recipes,
          packs,
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/storage') {
        json(response, 200, await this.dependencies.storage.report());
        return;
      }
      const workspaceFileMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/plugins\/([^/]+)\/file$/);
      if (workspaceFileMatch && (request.method === 'GET' || request.method === 'PUT')) {
        const workspaceId = decodeURIComponent(workspaceFileMatch[1]!);
        const targetPluginId = decodeURIComponent(workspaceFileMatch[2]!);
        const generation = Number(url.searchParams.get('generation'));
        const logicalPath = url.searchParams.get('path') ?? '';
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (generation !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        if (!workspace.runnerPlugins.some((target) => target.pluginId === targetPluginId)) {
          throw new Error('WORKSPACE_TARGET_NOT_FOUND');
        }
        if (request.method === 'GET') {
          const read = await this.dependencies.pluginRunner.openWorkspaceFileRead(
            workspaceId,
            generation,
            targetPluginId,
            logicalPath,
          );
          try {
            await binary(response, read.sizeBytes, read.source);
          } finally {
            await read.close();
          }
          return;
        }
        const expectedBytes = workspaceContentLength(request);
        await this.dependencies.pluginRunner.writeWorkspaceFileStream(
          workspaceId,
          generation,
          targetPluginId,
          logicalPath,
          request,
          expectedBytes,
        );
        json(response, 200, { writtenBytes: expectedBytes });
        return;
      }
      const commandMatch = url.pathname.match(/^\/v1\/commands\/([^/]+)$/);
      if (request.method === 'GET' && commandMatch) {
        const command = this.dependencies.journal.command(decodeURIComponent(commandMatch[1]!));
        if (!command) {
          json(response, 404, { error: 'COMMAND_NOT_FOUND' });
          return;
        }
        json(response, 200, command);
        return;
      }
      const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
      if (request.method === 'GET' && jobMatch) {
        const job = this.dependencies.journal.job(decodeURIComponent(jobMatch[1]!));
        if (!job) {
          json(response, 404, { error: 'JOB_NOT_FOUND' });
          return;
        }
        json(response, 200, job);
        return;
      }
      const workspaceJobsMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/jobs$/);
      if (request.method === 'POST' && workspaceJobsMatch) {
        const workspaceId = decodeURIComponent(workspaceJobsMatch[1]!);
        const input = asRecord(await body(request)) as unknown as WorkspaceJobInput;
        json(response, 202, this.beginWorkspaceJob(workspaceId, input));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/commands') {
        json(response, 202, this.beginCommand(await body(request)));
        return;
      }
      json(response, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error('RUNNER_STREAM_FAILED'));
        return;
      }
      const message = error instanceof Error ? error.message : 'RUNNER_ERROR';
      const status =
        message === 'VALIDATION_FAILED'
          ? 400
          : message === 'PAYLOAD_TOO_LARGE' || message === 'WORKSPACE_FILE_TOO_LARGE'
            ? 413
            : message.includes('NOT_FOUND')
              ? 404
              : message.includes('CONFLICT') || message.includes('MISMATCH')
                ? 409
                : message.includes('UNAVAILABLE')
                  ? 503
                  : 500;
      json(response, status, { error: message });
    }
  }

  private beginWorkspaceJob(workspaceId: string, input: WorkspaceJobInput) {
    const workspace = this.dependencies.journal.workspace(workspaceId);
    if (!workspace || workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');
    const now = Math.floor(Date.now() / 1000);
    const record = input as unknown as Record<string, unknown>;
    if (
      !hasOnlyKeys(record, ['jobId', 'generation', 'deadlineAt', 'argv', 'cwd', 'maxBytes', 'timeoutMs']) ||
      typeof input.jobId !== 'string' ||
      !/^[A-Za-z0-9-]{8,128}$/.test(input.jobId) ||
      input.generation !== workspace.generation ||
      !Number.isSafeInteger(input.deadlineAt) ||
      input.deadlineAt <= now ||
      !Array.isArray(input.argv) ||
      input.argv.length < 1 ||
      input.argv.length > 128 ||
      input.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
      typeof input.cwd !== 'string' ||
      input.cwd.length < 1 ||
      input.cwd.length > 4096 ||
      !Number.isSafeInteger(input.maxBytes) ||
      input.maxBytes < 1 ||
      input.maxBytes > 1024 * 1024 ||
      !Number.isSafeInteger(input.timeoutMs) ||
      input.timeoutMs < 1 ||
      input.timeoutMs > 5 * 60 * 1000
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const request: WorkspaceJobRequest = { ...input, workspaceId };
    const hash = payloadHash(request);
    const priorJob = this.dependencies.journal.job(request.jobId);
    const job = this.dependencies.journal.beginJob(request.jobId, hash, workspaceId, request.generation);
    runnerLog('debug', 'Agent Runner Workspace job accepted', {
      jobId: request.jobId,
      workspaceId,
      generation: request.generation,
      replayed: priorJob !== null,
    });
    if (job.status === 'pending') {
      this.dependencies.journal.runningJob(request.jobId);
      void this.executeWorkspaceJob(request);
    }
    return this.dependencies.journal.job(request.jobId)!;
  }

  private async executeWorkspaceJob(request: WorkspaceJobRequest): Promise<void> {
    try {
      const result = await this.dependencies.runtimeEngine.executeJob(request);
      this.dependencies.journal.succeedJob(request.jobId, result);
      runnerLog('debug', 'Agent Runner Workspace job completed', {
        jobId: request.jobId,
        workspaceId: request.workspaceId,
        generation: request.generation,
        exitCode: result.exitCode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.dependencies.journal.failJob(request.jobId, message);
      runnerLog('warn', 'Agent Runner Workspace job failed', {
        jobId: request.jobId,
        workspaceId: request.workspaceId,
        generation: request.generation,
        errorCode: message.slice(0, 200),
      });
    }
  }

  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization;
    return (
      typeof header === 'string' &&
      header.startsWith('Bearer ') &&
      equalsToken(header.slice(7), this.dependencies.token)
    );
  }

  private beginCommand(input: unknown) {
    const record = asRecord(input);
    const action = typeof record.action === 'string' ? record.action : '';
    if (['cacheCleanup', 'runtimeCleanup', 'packInstall', 'packUninstall'].includes(action)) {
      return this.beginAdminCommand(
        record,
        action as 'cacheCleanup' | 'runtimeCleanup' | 'packInstall' | 'packUninstall',
      );
    }
    const command = record as unknown as WorkspaceRuntimeCommand;
    this.validateCommand(command);
    const hash = payloadHash(command);
    const priorCommand = this.dependencies.journal.command(command.commandId);
    const existing = this.dependencies.journal.begin(command.commandId, hash, command.action, command.workspaceId);
    runnerLog('debug', 'Agent Runner Workspace command accepted', {
      commandId: command.commandId,
      action: command.action,
      workspaceId: command.workspaceId,
      generation: command.generation,
      replayed: priorCommand !== null,
    });
    if (existing.status === 'pending') {
      this.dependencies.journal.running(command.commandId);
      void this.executeWorkspaceCommand(command);
    }
    return this.dependencies.journal.command(command.commandId)!;
  }

  private async executeWorkspaceCommand(command: WorkspaceRuntimeCommand): Promise<void> {
    try {
      if (command.action === 'provision') await this.provision(command);
      else await this.workspaceAction(command);
      this.dependencies.journal.succeed(command.commandId, null);
      runnerLog('debug', 'Agent Runner Workspace command completed', {
        commandId: command.commandId,
        action: command.action,
        workspaceId: command.workspaceId,
        generation: command.generation,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.dependencies.journal.fail(command.commandId, message);
      runnerLog('warn', 'Agent Runner Workspace command failed', {
        commandId: command.commandId,
        action: command.action,
        workspaceId: command.workspaceId,
        generation: command.generation,
        errorCode: message.slice(0, 200),
      });
    }
  }

  private beginAdminCommand(
    command: Record<string, unknown>,
    action: 'cacheCleanup' | 'runtimeCleanup' | 'packInstall' | 'packUninstall',
  ) {
    this.validateAdminCommand(command, action);
    const commandId = String(command.commandId);
    const hash = payloadHash(command);
    const priorCommand = this.dependencies.journal.command(commandId);
    const existing = this.dependencies.journal.begin(commandId, hash, action, null);
    runnerLog('debug', 'Agent Runner admin command accepted', { commandId, action, replayed: priorCommand !== null });
    if (existing.status === 'pending') {
      this.dependencies.journal.running(commandId);
      void this.executeAdminCommand(command, action);
    }
    return this.dependencies.journal.command(commandId)!;
  }

  private async executeAdminCommand(
    command: Record<string, unknown>,
    action: 'cacheCleanup' | 'runtimeCleanup' | 'packInstall' | 'packUninstall',
  ): Promise<void> {
    const commandId = String(command.commandId);
    try {
      let result: unknown;
      if (action === 'cacheCleanup') result = this.dependencies.cleanup.cacheCleanup();
      else if (action === 'runtimeCleanup') {
        result = await this.dependencies.cleanup.runtimeCleanup(command.workspaceIds as string[]);
      } else if (action === 'packInstall') {
        const packs = command.packs as never[];
        await this.dependencies.installer.ensure(packs, commandId);
        result = { installed: packs.length };
      } else {
        const ref = command.pack as { familyId: string; versionId: string; contentDigest: string };
        const inUse = this.dependencies.journal
          .workspaces()
          .filter((workspace) => !['deleted', 'failed'].includes(workspace.status))
          .some((workspace) =>
            workspace.toolchain.some(
              (candidate) =>
                candidate.familyId === ref.familyId &&
                candidate.versionId === ref.versionId &&
                candidate.contentDigest === ref.contentDigest,
            ),
          );
        if (inUse) throw new Error('WORKSPACE_TOOLCHAIN_IN_USE');
        await this.dependencies.installer.uninstall(ref);
        result = { uninstalled: true };
      }
      this.dependencies.journal.succeed(commandId, result);
      const cleanupResult =
        action === 'runtimeCleanup' && result && typeof result === 'object' && !Array.isArray(result)
          ? (result as { deleted?: unknown[]; skipped?: unknown[]; quarantined?: unknown[] })
          : null;
      runnerLog('info', 'Agent Runner admin command completed', {
        commandId,
        action,
        ...(cleanupResult
          ? {
              deletedWorkspaceCount: cleanupResult.deleted?.length ?? 0,
              skippedWorkspaceCount: cleanupResult.skipped?.length ?? 0,
              quarantinedWorkspaceCount: cleanupResult.quarantined?.length ?? 0,
            }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.dependencies.journal.fail(commandId, message);
      runnerLog('warn', 'Agent Runner admin command failed', { commandId, action, errorCode: message.slice(0, 200) });
    }
  }

  private validateCommonCommand(command: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof command.commandId !== 'string' ||
      !/^[A-Za-z0-9-]{8,128}$/.test(command.commandId) ||
      !Number.isSafeInteger(command.deadlineAt) ||
      (command.deadlineAt as number) <= now
    ) {
      throw new Error('VALIDATION_FAILED');
    }
  }

  private validateAdminCommand(
    command: Record<string, unknown>,
    action: 'cacheCleanup' | 'runtimeCleanup' | 'packInstall' | 'packUninstall',
  ): void {
    this.validateCommonCommand(command);
    const common = ['commandId', 'action', 'deadlineAt'];
    const specific =
      action === 'runtimeCleanup'
        ? ['workspaceIds']
        : action === 'packInstall'
          ? ['packs']
          : action === 'packUninstall'
            ? ['pack']
            : [];
    if (!hasOnlyKeys(command, [...common, ...specific]) || command.action !== action) {
      throw new Error('VALIDATION_FAILED');
    }
    if (action === 'runtimeCleanup') {
      const workspaceIds = command.workspaceIds;
      if (
        !Array.isArray(workspaceIds) ||
        workspaceIds.length > 4096 ||
        workspaceIds.some((value) => typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(value)) ||
        new Set(workspaceIds).size !== workspaceIds.length
      ) {
        throw new Error('VALIDATION_FAILED');
      }
    } else if (action === 'packInstall') {
      if (!Array.isArray(command.packs) || command.packs.length < 1 || command.packs.length > 32) {
        throw new Error('VALIDATION_FAILED');
      }
    } else if (action === 'packUninstall') {
      const pack = command.pack;
      if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('VALIDATION_FAILED');
      const ref = pack as { familyId?: unknown; versionId?: unknown; contentDigest?: unknown };
      if (
        typeof ref.familyId !== 'string' ||
        typeof ref.versionId !== 'string' ||
        typeof ref.contentDigest !== 'string'
      ) {
        throw new Error('VALIDATION_FAILED');
      }
    }
  }

  private validateCommand(command: WorkspaceRuntimeCommand): void {
    const record = command as unknown as Record<string, unknown>;
    this.validateCommonCommand(record);
    if (
      !['provision', 'start', 'stop', 'restart', 'delete'].includes(command.action) ||
      typeof command.workspaceId !== 'string' ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(command.workspaceId) ||
      !Number.isSafeInteger(command.generation) ||
      command.generation < 1
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const common = ['commandId', 'workspaceId', 'generation', 'action', 'deadlineAt'];
    if (command.action !== 'provision') {
      if (!hasOnlyKeys(record, common)) throw new Error('VALIDATION_FAILED');
      return;
    }
    const provisionKeys = [
      ...common,
      'recipeId',
      'recipeRevision',
      'runtimeDigest',
      'catalogRevision',
      'toolchain',
      'runnerPlugins',
      'acpProfiles',
      'browserTarget',
      'retained',
    ];
    if (
      !hasOnlyKeys(record, provisionKeys) ||
      typeof command.recipeId !== 'string' ||
      typeof command.recipeRevision !== 'string' ||
      typeof command.runtimeDigest !== 'string' ||
      typeof command.catalogRevision !== 'string' ||
      !Array.isArray(command.toolchain) ||
      typeof command.retained !== 'boolean'
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    validateWorkspaceBindings(command);
    const catalog = this.dependencies.catalog.load();
    if (command.catalogRevision !== catalog.revision || command.runtimeDigest !== catalog.runtimeDigest) {
      throw new Error('CATALOG_REVISION_CONFLICT');
    }
    const recipe = this.dependencies.catalog.recipe(command.recipeId);
    if (recipe.revision !== command.recipeRevision) throw new Error('WORKSPACE_RECIPE_STALE');
    this.dependencies.catalog.validateSelection(command.recipeId, command.toolchain);
    const targets = command.runnerPlugins;
    if (!Array.isArray(targets) || targets.length > 64) throw new Error('PLUGIN_RUNNER_TARGET_INVALID');
    const targetIds = new Set<string>();
    for (const target of targets) {
      if (
        !target ||
        typeof target.pluginId !== 'string' ||
        typeof target.version !== 'string' ||
        typeof target.sdkVersion !== 'string' ||
        target.protocolVersion !== PLUGIN_RUNNER_PROTOCOL_VERSION ||
        typeof target.packageHash !== 'string' ||
        typeof target.entry !== 'string' ||
        targetIds.has(target.pluginId)
      ) {
        throw new Error('PLUGIN_RUNNER_TARGET_INVALID');
      }
      targetIds.add(target.pluginId);
    }
  }

  private async provision(command: WorkspaceProvisionCommand): Promise<void> {
    const current = this.dependencies.journal.workspace(command.workspaceId);
    if (current && current.generation >= command.generation && current.status !== 'deleted') {
      throw new Error('WORKSPACE_GENERATION_CONFLICT');
    }
    await this.dependencies.installer.ensure(command.toolchain, command.commandId);
    const creating: WorkspaceRecord = {
      workspaceId: command.workspaceId,
      generation: command.generation,
      status: 'creating',
      retained: command.retained,
      toolchain: command.toolchain.map((pack) => ({ ...pack })),
      runnerPlugins: command.runnerPlugins.map((target) => ({ ...target })),
      acpProfiles: command.acpProfiles.map((profile) => ({ ...profile, argv: [...profile.argv] })),
      browserTarget: command.browserTarget
        ? {
            ...command.browserTarget,
            endpoints: command.browserTarget.endpoints.map((endpoint) => ({ ...endpoint })),
            allowedUrlPatterns: [...command.browserTarget.allowedUrlPatterns],
          }
        : null,
    };
    this.dependencies.journal.saveWorkspace(creating);
    await this.dependencies.runtimeEngine.create(command);
    const ready: WorkspaceRecord = { ...creating, status: 'ready' };
    this.dependencies.pluginRunner.prepareWorkspace(ready);
    this.dependencies.journal.saveWorkspace(ready);
  }

  private async workspaceAction(command: WorkspaceLifecycleCommand): Promise<void> {
    const workspace = this.dependencies.journal.workspace(command.workspaceId);
    if (!workspace || workspace.generation !== command.generation) throw new Error('WORKSPACE_NOT_FOUND');
    if (command.action === 'start') {
      await this.dependencies.runtimeEngine.start(workspace.workspaceId, workspace.generation);
      try {
        await this.dependencies.pluginRunner.activateWorkspace(workspace);
      } catch (error) {
        await this.dependencies.runtimeEngine.stop(workspace.workspaceId, workspace.generation).catch(() => undefined);
        throw error;
      }
      this.save(workspace, 'running');
      return;
    }
    if (command.action === 'stop') {
      this.dependencies.acpRuntime.closeWorkspace(workspace.workspaceId, workspace.generation);
      this.dependencies.terminalRuntime.closeWorkspace(workspace.workspaceId, workspace.generation);
      this.dependencies.browserTunnel.closeWorkspace(workspace.workspaceId, workspace.generation);
      await this.dependencies.pluginRunner.quiesceWorkspace(workspace, Math.floor(Date.now() / 1000) + 10);
      await this.dependencies.pluginRunner.disposeWorkspace(workspace);
      await this.dependencies.runtimeEngine.stop(workspace.workspaceId, workspace.generation);
      this.save(workspace, 'stopped');
      return;
    }
    if (command.action === 'restart') {
      this.dependencies.acpRuntime.closeWorkspace(workspace.workspaceId, workspace.generation);
      this.dependencies.terminalRuntime.closeWorkspace(workspace.workspaceId, workspace.generation);
      this.dependencies.browserTunnel.closeWorkspace(workspace.workspaceId, workspace.generation);
      await this.dependencies.pluginRunner.disposeWorkspace(workspace);
      await this.dependencies.runtimeEngine.restart(workspace.workspaceId, workspace.generation);
      await this.dependencies.pluginRunner.activateWorkspace(workspace);
      this.save(workspace, 'running');
      return;
    }
    this.dependencies.acpRuntime.closeWorkspace(workspace.workspaceId, workspace.generation);
    this.dependencies.terminalRuntime.closeWorkspace(workspace.workspaceId, workspace.generation);
    this.dependencies.browserTunnel.closeWorkspace(workspace.workspaceId, workspace.generation);
    await this.dependencies.pluginRunner.disposeWorkspace(workspace);
    await this.dependencies.runtimeEngine.remove(workspace.workspaceId, workspace.generation);
    this.save(workspace, 'deleted');
  }

  private save(workspace: WorkspaceRecord, status: WorkspaceRecord['status']): void {
    this.dependencies.journal.saveWorkspace({ ...workspace, status });
  }
}
