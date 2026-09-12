import { createHash, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PLUGIN_RUNNER_PROTOCOL_VERSION } from '../plugin-sdk.types';
import type { WorkspaceRuntimeCommand, WorkspaceJobRequest, WorkspaceRecord } from '../types';
import { WorkspaceRuntimeCatalog } from './workspace-runtime-catalog';
import { SandboxEngine } from './sandbox-engine';
import { RunnerJournal, payloadHash } from './journal';
import { PackInstaller } from './pack-installer';
import { QuotaManager } from './quota-manager';
import { SpaceReporter } from './space-reporter';
import { CleanupPlanner } from './cleanup-planner';
import { PluginRunnerRuntime } from './plugin-runner-runtime';
import { MAX_HOST_WORKSPACE_TRANSFER_BYTES, type WorkspacePermission } from './workspace-broker';
import type { AcpProcessRuntime } from './acp-process-runtime';
import type { WorkspaceTerminalRuntime } from './workspace-terminal-runtime';
import type { BrowserTunnelRuntime } from './browser-tunnel-runtime';
import type { WorkspaceBrowserEndpoint } from '../types';

const RUNNER_API_VERSION = '2026-09-11';
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

const SAFE_RUNTIME_RESOURCE_ID = /^[a-z][a-z0-9_.-]{0,127}$/;
const validBrowserUrlPattern = (value: string): boolean => {
  const match = /^(\*|https?|wss?):\/\/(\*\.)?([^/:?#]+)(?::(\d{1,5}))?(\/[^?#]*)?$/.exec(value.trim());
  if (!match) return false;
  const port = match[4];
  if (port && (Number(port) < 1 || Number(port) > 65535)) return false;
  const rawPath = match[5];
  return !rawPath || !rawPath.includes('*') || rawPath.endsWith('*');
};

const validateFrozenRuntimeResources = (command: WorkspaceRuntimeCommand): void => {
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
  deploymentId: string;
  catalog: WorkspaceRuntimeCatalog;
  journal: RunnerJournal;
  sandboxEngine: SandboxEngine;
  installer: PackInstaller;
  quota: QuotaManager;
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
      if (request.headers['x-nexus-agent-protocol'] !== RUNNER_API_VERSION) {
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
        if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('VALIDATION_FAILED');
        const publicKey = request.headers['x-nexus-terminal-public-key'];
        if (typeof publicKey !== 'string') throw new Error('WORKSPACE_TERMINAL_PUBLIC_KEY_INVALID');
        this.dependencies.terminalRuntime.handleUpgrade(
          request,
          socket,
          head,
          decodeURIComponent(terminal[1]!),
          generation,
          publicKey,
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
      if (request.headers['x-nexus-agent-protocol'] !== RUNNER_API_VERSION) {
        json(response, 426, { error: 'RUNNER_PROTOCOL_UNSUPPORTED', expected: RUNNER_API_VERSION });
        return;
      }
      const url = new URL(request.url ?? '/', 'http://runner.internal');
      if (request.method === 'GET' && url.pathname === '/v1/availability') {
        const sandbox = this.dependencies.sandboxEngine.availability();
        json(response, 200, {
          available: sandbox.available,
          state: sandbox.available ? 'ready' : 'degraded',
          reason: sandbox.available ? 'ready' : (sandbox.reason ?? 'sandbox_unavailable'),
          deploymentId: this.dependencies.deploymentId,
          controllerVersion: '1.0.0',
          sandbox,
          capabilities: { egressAllowlist: false },
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
            schemaVersion: 1 as const,
            familyId: pack.familyId,
            versionId: pack.versionId,
            displayName: pack.displayName,
            contentDigest,
            capabilities: pack.capabilities,
            runnerApiRange: pack.runnerApiRange,
            diskBytes: pack.diskBytes,
            dependencies: pack.dependencies,
            supportedArchitectures: pack.supportedArchitectures,
            status: supported ? pack.status : ('unavailable' as const),
            sideBySide: pack.sideBySide,
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
        json(response, 200, this.dependencies.storage.report());
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
        if (!(workspace.runnerPlugins ?? []).some((target) => target.pluginId === targetPluginId)) {
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
      const workspaceGrantMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/plugins\/([^/]+)\/grants$/);
      if (workspaceGrantMatch && (request.method === 'GET' || request.method === 'POST')) {
        const workspaceId = decodeURIComponent(workspaceGrantMatch[1]!);
        const targetPluginId = decodeURIComponent(workspaceGrantMatch[2]!);
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
        const targetIds = new Set((workspace.runnerPlugins ?? []).map((target) => target.pluginId));
        if (!targetIds.has(targetPluginId)) throw new Error('WORKSPACE_TARGET_NOT_FOUND');
        if (request.method === 'GET') {
          const generation = Number(url.searchParams.get('generation'));
          if (generation !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
          const grantSet = this.dependencies.pluginRunner.workspaceGrants(workspaceId, generation, targetPluginId);
          json(response, 200, { targetPluginId, ...grantSet });
          return;
        }
        const input = asRecord(await body(request));
        const generation = Number(input.generation);
        const expectedRevision = Number(input.expectedRevision);
        if (
          generation !== workspace.generation ||
          !Number.isSafeInteger(expectedRevision) ||
          expectedRevision < 1 ||
          !Array.isArray(input.grants) ||
          input.grants.length > 256
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const grants = input.grants.map((candidate) => {
          const grant = asRecord(candidate);
          const principalPluginId = String(grant.principalPluginId ?? '');
          const grantPath = String(grant.path ?? '');
          if (
            !targetIds.has(principalPluginId) ||
            principalPluginId === targetPluginId ||
            !Array.isArray(grant.permissions)
          ) {
            throw new Error('WORKSPACE_GRANT_INVALID');
          }
          const permissions = grant.permissions.map(String) as WorkspacePermission[];
          return { principalPluginId, path: grantPath, permissions };
        });
        const grantSet = this.dependencies.pluginRunner.replaceWorkspaceGrants(
          workspaceId,
          generation,
          targetPluginId,
          grants,
          expectedRevision,
        );
        json(response, 200, { targetPluginId, ...grantSet });
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
      const workspaceMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)$/);
      if (request.method === 'GET' && workspaceMatch) {
        const workspace = this.dependencies.journal.workspace(decodeURIComponent(workspaceMatch[1]!));
        if (!workspace) {
          json(response, 404, { error: 'WORKSPACE_NOT_FOUND' });
          return;
        }
        json(response, 200, workspace);
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
        const requestBody = asRecord(await body(request)) as unknown as WorkspaceJobRequest;
        json(response, 202, this.beginWorkspaceJob(workspaceId, requestBody));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/setup/preview') {
        const input = asRecord(await body(request));
        const recipeId = String(input.recipeId ?? '');
        const versions = (
          input.versions && typeof input.versions === 'object' && !Array.isArray(input.versions) ? input.versions : {}
        ) as Record<string, string>;
        const recipe = this.dependencies.catalog.recipe(recipeId);
        const packs = this.dependencies.catalog.resolve(recipeId, versions);
        json(response, 200, {
          recipe,
          packs,
          missingPacks: packs,
          limits: recipe.defaultLimits,
          network: recipe.networkDefaults,
        });
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

  private beginWorkspaceJob(workspaceId: string, request: WorkspaceJobRequest) {
    const workspace = this.dependencies.journal.workspace(workspaceId);
    if (!workspace || !workspace.sandboxId || workspace.status !== 'running') {
      throw new Error('WORKSPACE_NOT_RUNNING');
    }
    const now = Math.floor(Date.now() / 1000);
    if (
      !request ||
      typeof request !== 'object' ||
      request.workspaceId !== workspaceId ||
      typeof request.jobId !== 'string' ||
      !/^[A-Za-z0-9-]{8,128}$/.test(request.jobId) ||
      request.userId !== workspace.userId ||
      request.appId !== workspace.appId ||
      request.runId !== workspace.runId ||
      request.agentRuntimeId !== workspace.agentRuntimeId ||
      request.generation !== workspace.generation ||
      typeof request.operationHash !== 'string' ||
      !/^v1:[a-f0-9]{64}$/.test(request.operationHash) ||
      !Number.isSafeInteger(request.issuedAt) ||
      request.issuedAt > now + 60 ||
      !Number.isSafeInteger(request.deadlineAt) ||
      request.deadlineAt <= now ||
      typeof request.nonce !== 'string' ||
      request.nonce.length < 8 ||
      request.nonce.length > 256 ||
      !Array.isArray(request.argv) ||
      request.argv.length < 1 ||
      request.argv.length > 128 ||
      request.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
      typeof request.cwd !== 'string' ||
      request.cwd.length < 1 ||
      request.cwd.length > 4096 ||
      !Number.isSafeInteger(request.maxBytes) ||
      request.maxBytes < 1 ||
      request.maxBytes > 1024 * 1024 ||
      !Number.isSafeInteger(request.timeoutMs) ||
      request.timeoutMs < 1 ||
      request.timeoutMs > 5 * 60 * 1000
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const hash = payloadHash(request);
    const job = this.dependencies.journal.beginJob(request.jobId, hash, workspaceId, request.generation);
    if (job.status === 'pending') {
      this.dependencies.journal.runningJob(request.jobId);
      void this.executeWorkspaceJob(workspace.sandboxId, request);
    }
    return this.dependencies.journal.job(request.jobId)!;
  }

  private async executeWorkspaceJob(sandboxId: string, request: WorkspaceJobRequest): Promise<void> {
    try {
      const result = await this.dependencies.sandboxEngine.executeJob(sandboxId, request);
      this.dependencies.journal.succeedJob(request.jobId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.dependencies.journal.failJob(request.jobId, message);
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
    const existing = this.dependencies.journal.begin(command.commandId, hash, command.action, command.workspaceId);
    if (existing.status === 'pending') {
      this.dependencies.journal.running(command.commandId);
      void this.executeWorkspaceCommand(command);
    }
    return this.dependencies.journal.command(command.commandId)!;
  }

  private async executeWorkspaceCommand(command: WorkspaceRuntimeCommand): Promise<void> {
    try {
      const result =
        command.action === 'provision' ? await this.provision(command) : await this.workspaceAction(command);
      this.dependencies.journal.succeed(command.commandId, result);
    } catch (error) {
      this.dependencies.journal.fail(command.commandId, error instanceof Error ? error.message : String(error));
    }
  }

  private beginAdminCommand(
    command: Record<string, unknown>,
    action: 'cacheCleanup' | 'runtimeCleanup' | 'packInstall' | 'packUninstall',
  ) {
    this.validateCommonCommand(command);
    const commandId = String(command.commandId);
    const hash = payloadHash(command);
    const existing = this.dependencies.journal.begin(commandId, hash, action, null);
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
        const workspaceIds = command.workspaceIds;
        if (
          !Array.isArray(workspaceIds) ||
          workspaceIds.length > 4096 ||
          workspaceIds.some((value) => typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(value)) ||
          new Set(workspaceIds).size !== workspaceIds.length
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        result = await this.dependencies.cleanup.runtimeCleanup(command.userId as number, workspaceIds as string[]);
      } else if (action === 'packInstall') {
        const packs = Array.isArray(command.packs) ? command.packs : [];
        if (!packs.length || packs.length > 32) throw new Error('VALIDATION_FAILED');
        await this.dependencies.installer.ensure(packs as never[], commandId);
        result = { installed: packs.length };
      } else {
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
        await this.dependencies.installer.uninstall({
          familyId: ref.familyId,
          versionId: ref.versionId,
          contentDigest: ref.contentDigest,
        });
        result = { uninstalled: true };
      }
      this.dependencies.journal.succeed(commandId, result);
    } catch (error) {
      this.dependencies.journal.fail(commandId, error instanceof Error ? error.message : String(error));
    }
  }

  private validateCommonCommand(command: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof command.commandId !== 'string' ||
      !command.commandId ||
      command.deploymentId !== this.dependencies.deploymentId ||
      !Number.isSafeInteger(command.userId) ||
      (command.userId as number) < 1 ||
      typeof command.appId !== 'string' ||
      !command.appId ||
      !Number.isSafeInteger(command.deadlineAt) ||
      (command.deadlineAt as number) <= now ||
      !Number.isSafeInteger(command.issuedAt) ||
      (command.issuedAt as number) > now + 60 ||
      typeof command.nonce !== 'string' ||
      !command.nonce ||
      command.nonce.length > 256 ||
      typeof command.operationHash !== 'string' ||
      !/^v1:[a-f0-9]{64}$/.test(command.operationHash)
    ) {
      throw new Error('VALIDATION_FAILED');
    }
  }

  private validateCommand(command: WorkspaceRuntimeCommand): void {
    this.validateCommonCommand(command as unknown as Record<string, unknown>);
    if (!command.workspaceId || !command.runId || !command.agentRuntimeId) {
      throw new Error('VALIDATION_FAILED');
    }
    if (!Number.isSafeInteger(command.generation) || command.generation < 1) throw new Error('VALIDATION_FAILED');
    validateFrozenRuntimeResources(command);
    if (command.action === 'provision') {
      const catalog = this.dependencies.catalog.load();
      if (command.catalogRevision !== catalog.revision || command.runtimeDigest !== catalog.runtimeDigest) {
        throw new Error('CATALOG_REVISION_CONFLICT');
      }
      const recipe = this.dependencies.catalog.recipe(command.recipeId);
      if (recipe.revision !== command.recipeRevision) throw new Error('WORKSPACE_RECIPE_STALE');
      this.dependencies.catalog.validateSelection(command.recipeId, command.toolchain);
      this.dependencies.quota.validate(command.limits);
      const targets = command.runnerPlugins ?? [];
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
  }

  private async provision(command: WorkspaceRuntimeCommand): Promise<WorkspaceRecord> {
    const current = this.dependencies.journal.workspace(command.workspaceId);
    if (current && current.generation >= command.generation && current.status !== 'deleted')
      throw new Error('WORKSPACE_GENERATION_CONFLICT');
    await this.dependencies.installer.ensure(command.toolchain, command.commandId);
    const now = Math.floor(Date.now() / 1000);
    const creating: WorkspaceRecord = {
      workspaceId: command.workspaceId,
      userId: command.userId,
      appId: command.appId,
      runId: command.runId,
      agentRuntimeId: command.agentRuntimeId,
      generation: command.generation,
      status: 'creating',
      sandboxId: null,
      commandId: command.commandId,
      retained: command.retained === true,
      recipeId: command.recipeId,
      recipeRevision: command.recipeRevision,
      runtimeDigest: command.runtimeDigest,
      catalogRevision: command.catalogRevision,
      toolchain: command.toolchain,
      runnerPlugins: (command.runnerPlugins ?? []).map((target) => ({ ...target })),
      limits: command.limits,
      network: command.network,
      acpProfiles: command.acpProfiles.map((profile) => ({ ...profile, argv: [...profile.argv] })),
      browserTarget: command.browserTarget
        ? {
            ...command.browserTarget,
            endpoints: command.browserTarget.endpoints.map((endpoint) => ({ ...endpoint })),
            allowedUrlPatterns: [...command.browserTarget.allowedUrlPatterns],
          }
        : null,
      updatedAt: now,
    };
    this.dependencies.journal.saveWorkspace(creating);
    const sandboxId = await this.dependencies.sandboxEngine.create(command);
    const ready: WorkspaceRecord = {
      ...creating,
      sandboxId,
      status: 'ready',
      updatedAt: Math.floor(Date.now() / 1000),
    };
    this.dependencies.pluginRunner.prepareWorkspace(ready);
    this.dependencies.journal.saveWorkspace(ready);
    return ready;
  }

  private async workspaceAction(command: WorkspaceRuntimeCommand): Promise<WorkspaceRecord> {
    const workspace = this.dependencies.journal.workspace(command.workspaceId);
    if (!workspace || workspace.generation !== command.generation || !workspace.sandboxId) {
      throw new Error('WORKSPACE_NOT_FOUND');
    }
    const samePacks = JSON.stringify(workspace.toolchain) === JSON.stringify(command.toolchain);
    const sameRunnerPlugins =
      JSON.stringify(workspace.runnerPlugins ?? []) === JSON.stringify(command.runnerPlugins ?? []);
    const sameAcpProfiles = JSON.stringify(workspace.acpProfiles) === JSON.stringify(command.acpProfiles);
    const sameBrowserTarget = JSON.stringify(workspace.browserTarget) === JSON.stringify(command.browserTarget);
    if (
      workspace.userId !== command.userId ||
      workspace.appId !== command.appId ||
      workspace.runId !== command.runId ||
      workspace.agentRuntimeId !== command.agentRuntimeId ||
      workspace.recipeId !== command.recipeId ||
      workspace.recipeRevision !== command.recipeRevision ||
      workspace.runtimeDigest !== command.runtimeDigest ||
      workspace.catalogRevision !== command.catalogRevision ||
      !samePacks ||
      !sameRunnerPlugins ||
      !sameAcpProfiles ||
      !sameBrowserTarget
    ) {
      throw new Error('WORKSPACE_IDENTITY_MISMATCH');
    }
    if (command.action === 'start') {
      await this.dependencies.sandboxEngine.start(workspace.sandboxId);
      try {
        await this.dependencies.pluginRunner.activateWorkspace(workspace);
      } catch (error) {
        await this.dependencies.sandboxEngine.stop(workspace.sandboxId).catch(() => undefined);
        throw error;
      }
      return this.save(workspace, 'running', command.commandId);
    }
    if (command.action === 'stop') {
      this.dependencies.acpRuntime.closeWorkspace(workspace.workspaceId, workspace.generation);
      this.dependencies.terminalRuntime.closeWorkspace(workspace.workspaceId, workspace.generation);
      this.dependencies.browserTunnel.closeWorkspace(workspace.workspaceId, workspace.generation);
      await this.dependencies.pluginRunner.quiesceWorkspace(workspace, Math.floor(Date.now() / 1000) + 10);
      await this.dependencies.pluginRunner.disposeWorkspace(workspace);
      await this.dependencies.sandboxEngine.stop(workspace.sandboxId);
      return this.save(workspace, 'stopped', command.commandId);
    }
    if (command.action === 'restart') {
      this.dependencies.acpRuntime.closeWorkspace(workspace.workspaceId, workspace.generation);
      this.dependencies.terminalRuntime.closeWorkspace(workspace.workspaceId, workspace.generation);
      this.dependencies.browserTunnel.closeWorkspace(workspace.workspaceId, workspace.generation);
      await this.dependencies.pluginRunner.disposeWorkspace(workspace);
      await this.dependencies.sandboxEngine.restart(workspace.sandboxId);
      await this.dependencies.pluginRunner.activateWorkspace(workspace);
      return this.save(workspace, 'running', command.commandId);
    }
    if (command.action === 'delete') {
      this.dependencies.acpRuntime.closeWorkspace(workspace.workspaceId, workspace.generation);
      this.dependencies.terminalRuntime.closeWorkspace(workspace.workspaceId, workspace.generation);
      this.dependencies.browserTunnel.closeWorkspace(workspace.workspaceId, workspace.generation);
      await this.dependencies.pluginRunner.disposeWorkspace(workspace);
      await this.dependencies.sandboxEngine.remove(workspace.sandboxId);
      return this.save(workspace, 'deleted', command.commandId);
    }
    if (command.action === 'setNetwork' || command.action === 'resize') throw new Error('WORKSPACE_RECREATE_REQUIRED');
    throw new Error('VALIDATION_FAILED');
  }

  private save(workspace: WorkspaceRecord, status: WorkspaceRecord['status'], commandId: string): WorkspaceRecord {
    const next = { ...workspace, status, commandId, updatedAt: Math.floor(Date.now() / 1000) };
    this.dependencies.journal.saveWorkspace(next);
    return next;
  }
}
