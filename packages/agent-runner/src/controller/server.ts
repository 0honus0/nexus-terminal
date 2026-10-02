import type { WorkspaceJobInput, WorkspaceBrowserEndpoint } from '@nexus-terminal/protocol/runner';
import { createHash, timingSafeEqual } from 'node:crypto';
import runnerVersion = require('@nexus-terminal/protocol/runner-version.json');
import type { RunnerCommandWireResponse } from '@nexus-terminal/protocol/runner';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { CommandRecord } from '../types';
import { WorkspaceRuntimeCatalog } from './workspace-runtime-catalog';
import { WorkspaceRuntimeEngine } from './workspace-runtime-engine';
import { RunnerJournal } from './journal';
import { PackInstaller } from './pack-installer';
import { SpaceReporter } from './space-reporter';
import { CleanupPlanner } from './cleanup-planner';
import { PluginRunnerRuntime } from './plugin-runner-runtime';
import { MAX_HOST_WORKSPACE_TRANSFER_BYTES } from './plugin-workspace-store';
import type { AcpProcessRuntime } from './acp-process-runtime';
import type { WorkspaceTerminalRuntime } from './workspace-terminal-runtime';
import type { BrowserTunnelRuntime } from './browser-tunnel-runtime';

import { RunnerCommandExecutor } from './runner-command-executor';
import { asRecord, hasOnlyKeys, decodeBrowserEndpoint } from './runner-request-validation';

const { RUNNER_PROTOCOL_VERSION } = runnerVersion;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_JOB_WAIT_MS = 5 * 60 * 1000;
const RUNNER_CLIENT_INPUT_ERRORS = new Set([
  'WORKSPACE_PATH_INVALID',
  'WORKSPACE_PATH_FORBIDDEN',
  'WORKSPACE_FILE_INVALID',
  'WORKSPACE_FILE_NOT_TEXT',
  'WORKSPACE_BYTE_RANGE_INVALID',
  'WORKSPACE_SEARCH_INVALID',
  'WORKSPACE_PATCH_INVALID',
  'WORKSPACE_PATCH_UNSUPPORTED',
  'WORKSPACE_PATCH_PRECONDITION_MISSING',
]);
const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(body));
};

const commandWireResponse = (command: CommandRecord): RunnerCommandWireResponse => ({
  commandId: command.commandId,
  status: command.status,
  ...(command.result === null ? {} : { result: command.result }),
  ...(command.error === null ? {} : { error: command.error }),
});

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
  private readonly commands: RunnerCommandExecutor;

  constructor(private readonly dependencies: RunnerControllerDependencies) {
    this.commands = new RunnerCommandExecutor(dependencies);
  }

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
          endpoint = decodeBrowserEndpoint(
            JSON.parse(Buffer.from(rawEndpoint, 'base64url').toString('utf8')) as unknown,
          );
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
    const errorCode = /^[A-Z][A-Z0-9_]{0,127}$/.test(code) ? code : 'VALIDATION_FAILED';
    socket.end(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nX-Nexus-Agent-Error: ${errorCode}\r\n\r\n${JSON.stringify({ error: errorCode })}`,
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
          const ref = { familyId: pack.familyId, versionId: pack.versionId };
          const supported =
            Boolean(pack.downloadRefByArch[process.arch]) && pack.supportedArchitectures.includes(process.arch);
          return {
            familyId: pack.familyId,
            versionId: pack.versionId,
            displayName: pack.displayName,
            diskBytes: pack.diskBytes,
            status: supported ? pack.status : ('unavailable' as const),
            installed: supported && this.dependencies.installer.installed(ref),
            enabled: supported && pack.status === 'supported',
            inUse:
              supported &&
              active.some((workspace) =>
                workspace.toolchain.some(
                  (candidate) => candidate.familyId === ref.familyId && candidate.versionId === ref.versionId,
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
      const workspaceStatusMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/status$/);
      if (request.method === 'GET' && workspaceStatusMatch) {
        const workspaceId = decodeURIComponent(workspaceStatusMatch[1]!);
        const generation = Number(url.searchParams.get('generation'));
        if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('VALIDATION_FAILED');
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
        if (workspace.generation !== generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        json(response, 200, {
          workspaceId: workspace.workspaceId,
          generation: workspace.generation,
          status: workspace.status,
        });
        return;
      }
      const projectInstructionsMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/project-instructions$/);
      if (request.method === 'POST' && projectInstructionsMatch) {
        const workspaceId = decodeURIComponent(projectInstructionsMatch[1]!);
        const input = asRecord(await body(request));
        if (!hasOnlyKeys(input, ['generation', 'targetDirectories'])) throw new Error('VALIDATION_FAILED');
        if (!Number.isSafeInteger(input.generation) || Number(input.generation) < 1) {
          throw new Error('VALIDATION_FAILED');
        }
        if (
          !Array.isArray(input.targetDirectories) ||
          input.targetDirectories.length > 8 ||
          input.targetDirectories.some(
            (value) => typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0'),
          )
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (Number(input.generation) !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        json(
          response,
          200,
          this.dependencies.runtimeEngine.projectInstructions(
            workspaceId,
            workspace.generation,
            input.targetDirectories as string[],
          ),
        );
        return;
      }
      const codingReadMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/coding\/read-file$/);
      if (request.method === 'POST' && codingReadMatch) {
        const workspaceId = decodeURIComponent(codingReadMatch[1]!);
        const input = asRecord(await body(request));
        if (
          !hasOnlyKeys(input, ['generation', 'path', 'startLine', 'endLine', 'offsetBytes', 'maxBytes']) ||
          !Number.isSafeInteger(input.generation) ||
          Number(input.generation) < 1 ||
          typeof input.path !== 'string'
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (Number(input.generation) !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        json(
          response,
          200,
          this.dependencies.runtimeEngine.readWorkspaceFile(workspaceId, workspace.generation, {
            path: input.path,
            ...(input.startLine === undefined ? {} : { startLine: Number(input.startLine) }),
            ...(input.endLine === undefined ? {} : { endLine: Number(input.endLine) }),
            ...(input.offsetBytes === undefined ? {} : { offsetBytes: Number(input.offsetBytes) }),
            ...(input.maxBytes === undefined ? {} : { maxBytes: Number(input.maxBytes) }),
          }),
        );
        return;
      }
      const codingStatMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/coding\/stat$/);
      if (request.method === 'POST' && codingStatMatch) {
        const workspaceId = decodeURIComponent(codingStatMatch[1]!);
        const input = asRecord(await body(request));
        if (
          !hasOnlyKeys(input, ['generation', 'path']) ||
          !Number.isSafeInteger(input.generation) ||
          Number(input.generation) < 1 ||
          typeof input.path !== 'string'
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (Number(input.generation) !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        json(
          response,
          200,
          this.dependencies.runtimeEngine.statWorkspacePath(workspaceId, workspace.generation, input.path),
        );
        return;
      }
      const codingWriteMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/coding\/write-file$/);
      if (request.method === 'POST' && codingWriteMatch) {
        const workspaceId = decodeURIComponent(codingWriteMatch[1]!);
        const input = asRecord(await body(request));
        if (
          !hasOnlyKeys(input, ['generation', 'path', 'content', 'expectedSha256']) ||
          !Number.isSafeInteger(input.generation) ||
          Number(input.generation) < 1 ||
          typeof input.path !== 'string' ||
          typeof input.content !== 'string' ||
          (input.expectedSha256 !== null && typeof input.expectedSha256 !== 'string')
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (Number(input.generation) !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        if (this.commands.hasActiveWorkspaceJob(workspaceId, workspace.generation))
          throw new Error('WORKSPACE_JOB_ACTIVE_CONFLICT');
        json(
          response,
          200,
          this.dependencies.runtimeEngine.writeWorkspaceFile(workspaceId, workspace.generation, {
            path: input.path,
            content: input.content,
            expectedSha256: input.expectedSha256 as string | null,
          }),
        );
        return;
      }
      const codingListMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/coding\/list$/);
      if (request.method === 'POST' && codingListMatch) {
        const workspaceId = decodeURIComponent(codingListMatch[1]!);
        const input = asRecord(await body(request));
        if (
          !hasOnlyKeys(input, ['generation', 'path', 'maxEntries']) ||
          !Number.isSafeInteger(input.generation) ||
          Number(input.generation) < 1 ||
          typeof input.path !== 'string' ||
          !Number.isSafeInteger(input.maxEntries)
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (Number(input.generation) !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        json(
          response,
          200,
          this.dependencies.runtimeEngine.listWorkspaceFiles(workspaceId, workspace.generation, {
            path: input.path,
            maxEntries: Number(input.maxEntries),
          }),
        );
        return;
      }
      const codingMoveMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/coding\/move$/);
      if (request.method === 'POST' && codingMoveMatch) {
        const workspaceId = decodeURIComponent(codingMoveMatch[1]!);
        const input = asRecord(await body(request));
        if (
          !hasOnlyKeys(input, ['generation', 'path', 'destinationPath', 'expectedSha256']) ||
          !Number.isSafeInteger(input.generation) ||
          Number(input.generation) < 1 ||
          typeof input.path !== 'string' ||
          typeof input.destinationPath !== 'string' ||
          (input.expectedSha256 !== null && typeof input.expectedSha256 !== 'string')
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (Number(input.generation) !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        if (this.commands.hasActiveWorkspaceJob(workspaceId, workspace.generation))
          throw new Error('WORKSPACE_JOB_ACTIVE_CONFLICT');
        json(
          response,
          200,
          this.dependencies.runtimeEngine.moveWorkspaceFile(workspaceId, workspace.generation, {
            path: input.path,
            destinationPath: input.destinationPath,
            expectedSha256: input.expectedSha256 as string | null,
          }),
        );
        return;
      }
      const codingDeleteMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/coding\/delete$/);
      if (request.method === 'POST' && codingDeleteMatch) {
        const workspaceId = decodeURIComponent(codingDeleteMatch[1]!);
        const input = asRecord(await body(request));
        if (
          !hasOnlyKeys(input, ['generation', 'path', 'recursive', 'expectedSha256']) ||
          !Number.isSafeInteger(input.generation) ||
          Number(input.generation) < 1 ||
          typeof input.path !== 'string' ||
          typeof input.recursive !== 'boolean' ||
          (input.expectedSha256 !== null && typeof input.expectedSha256 !== 'string')
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (Number(input.generation) !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        if (this.commands.hasActiveWorkspaceJob(workspaceId, workspace.generation))
          throw new Error('WORKSPACE_JOB_ACTIVE_CONFLICT');
        json(
          response,
          200,
          this.dependencies.runtimeEngine.deleteWorkspaceFile(workspaceId, workspace.generation, {
            path: input.path,
            recursive: input.recursive,
            expectedSha256: input.expectedSha256 as string | null,
          }),
        );
        return;
      }
      const codingSearchMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/coding\/search$/);
      if (request.method === 'POST' && codingSearchMatch) {
        const workspaceId = decodeURIComponent(codingSearchMatch[1]!);
        const input = asRecord(await body(request));
        if (
          !hasOnlyKeys(input, [
            'generation',
            'query',
            'path',
            'glob',
            'maxResults',
            'contextLines',
            'maxOutputBytes',
          ]) ||
          !Number.isSafeInteger(input.generation) ||
          Number(input.generation) < 1 ||
          typeof input.query !== 'string' ||
          typeof input.path !== 'string' ||
          !Number.isSafeInteger(input.maxResults) ||
          !Number.isSafeInteger(input.contextLines) ||
          !Number.isSafeInteger(input.maxOutputBytes) ||
          (input.glob !== undefined && typeof input.glob !== 'string')
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (Number(input.generation) !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        json(
          response,
          200,
          this.dependencies.runtimeEngine.searchWorkspace(workspaceId, workspace.generation, {
            query: input.query,
            path: input.path,
            ...(input.glob === undefined ? {} : { glob: input.glob }),
            maxResults: Number(input.maxResults),
            contextLines: Number(input.contextLines),
            maxOutputBytes: Number(input.maxOutputBytes),
          }),
        );
        return;
      }
      const codingRepoMapMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/coding\/repo-map$/);
      if (request.method === 'POST' && codingRepoMapMatch) {
        const workspaceId = decodeURIComponent(codingRepoMapMatch[1]!);
        const input = asRecord(await body(request));
        if (
          !hasOnlyKeys(input, ['generation', 'path', 'query', 'maxFiles', 'maxSymbols', 'maxOutputBytes']) ||
          !Number.isSafeInteger(input.generation) ||
          Number(input.generation) < 1 ||
          typeof input.path !== 'string' ||
          (input.query !== undefined && typeof input.query !== 'string') ||
          !Number.isSafeInteger(input.maxFiles) ||
          !Number.isSafeInteger(input.maxSymbols) ||
          !Number.isSafeInteger(input.maxOutputBytes)
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (Number(input.generation) !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        json(
          response,
          200,
          await this.dependencies.runtimeEngine.repoMap(workspaceId, workspace.generation, {
            path: input.path,
            ...(input.query === undefined ? {} : { query: input.query }),
            maxFiles: Number(input.maxFiles),
            maxSymbols: Number(input.maxSymbols),
            maxOutputBytes: Number(input.maxOutputBytes),
          }),
        );
        return;
      }
      const codingIntelMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/coding\/code-intel$/);
      if (request.method === 'POST' && codingIntelMatch) {
        const workspaceId = decodeURIComponent(codingIntelMatch[1]!);
        const input = asRecord(await body(request));
        if (
          !hasOnlyKeys(input, ['generation', 'action', 'path', 'line', 'column', 'maxResults', 'maxOutputBytes']) ||
          !Number.isSafeInteger(input.generation) ||
          Number(input.generation) < 1 ||
          typeof input.action !== 'string' ||
          typeof input.path !== 'string' ||
          (input.line !== undefined && !Number.isSafeInteger(input.line)) ||
          (input.column !== undefined && !Number.isSafeInteger(input.column)) ||
          !Number.isSafeInteger(input.maxResults) ||
          !Number.isSafeInteger(input.maxOutputBytes)
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (Number(input.generation) !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        json(
          response,
          200,
          await this.dependencies.runtimeEngine.codeIntel(workspaceId, workspace.generation, {
            action: input.action as 'symbols' | 'definition' | 'references' | 'diagnostics',
            path: input.path,
            ...(input.line === undefined ? {} : { line: Number(input.line) }),
            ...(input.column === undefined ? {} : { column: Number(input.column) }),
            maxResults: Number(input.maxResults),
            maxOutputBytes: Number(input.maxOutputBytes),
          }),
        );
        return;
      }
      const codingPatchMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/coding\/apply-patch$/);
      if (request.method === 'POST' && codingPatchMatch) {
        const workspaceId = decodeURIComponent(codingPatchMatch[1]!);
        const input = asRecord(await body(request));
        if (
          !hasOnlyKeys(input, ['generation', 'patch', 'expectedFiles', 'dryRun']) ||
          !Number.isSafeInteger(input.generation) ||
          Number(input.generation) < 1 ||
          typeof input.patch !== 'string' ||
          (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') ||
          !Array.isArray(input.expectedFiles) ||
          input.expectedFiles.some((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
            const record = item as Record<string, unknown>;
            return (
              !hasOnlyKeys(record, ['path', 'sha256']) ||
              typeof record.path !== 'string' ||
              typeof record.sha256 !== 'string'
            );
          })
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (Number(input.generation) !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        if (input.dryRun !== true && this.commands.hasActiveWorkspaceJob(workspaceId, workspace.generation)) {
          throw new Error('WORKSPACE_JOB_ACTIVE_CONFLICT');
        }
        json(
          response,
          200,
          this.dependencies.runtimeEngine.applyWorkspacePatch(workspaceId, workspace.generation, {
            patch: input.patch,
            ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
            expectedFiles: (input.expectedFiles as Array<Record<string, unknown>>).map((item) => ({
              path: item.path as string,
              sha256: item.sha256 as string,
            })),
          }),
        );
        return;
      }
      const checkpointArchiveMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/checkpoint\/archive$/);
      if (checkpointArchiveMatch && (request.method === 'GET' || request.method === 'PUT')) {
        const workspaceId = decodeURIComponent(checkpointArchiveMatch[1]!);
        const generation = Number(url.searchParams.get('generation'));
        const workspace = this.dependencies.journal.workspace(workspaceId);
        if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('WORKSPACE_NOT_FOUND');
        if (generation !== workspace.generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
        if (request.method === 'GET') {
          const read = await this.dependencies.runtimeEngine.openCheckpointArchive(workspaceId, generation);
          try {
            await binary(response, read.sizeBytes, read.source);
          } finally {
            await read.close();
          }
          return;
        }
        const expectedBytes = workspaceContentLength(request);
        await this.dependencies.runtimeEngine.restoreCheckpointArchive(workspaceId, generation, request, expectedBytes);
        json(response, 200, { restoredBytes: expectedBytes });
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
        json(response, 200, commandWireResponse(command));
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
      const jobWaitMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/wait$/);
      if (request.method === 'POST' && jobWaitMatch) {
        const input = asRecord(await body(request));
        if (
          !hasOnlyKeys(input, ['timeoutMs']) ||
          !Number.isSafeInteger(input.timeoutMs) ||
          Number(input.timeoutMs) < 1 ||
          Number(input.timeoutMs) > MAX_JOB_WAIT_MS
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        json(
          response,
          200,
          await this.commands.waitWorkspaceJob(decodeURIComponent(jobWaitMatch[1]!), Number(input.timeoutMs)),
        );
        return;
      }
      const jobCancelMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/cancel$/);
      if (request.method === 'POST' && jobCancelMatch) {
        const input = asRecord(await body(request));
        if (!hasOnlyKeys(input, [])) throw new Error('VALIDATION_FAILED');
        json(response, 200, await this.commands.cancelWorkspaceJob(decodeURIComponent(jobCancelMatch[1]!)));
        return;
      }
      const workspaceJobsMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/jobs$/);
      if (request.method === 'POST' && workspaceJobsMatch) {
        const workspaceId = decodeURIComponent(workspaceJobsMatch[1]!);
        const input = asRecord(await body(request)) as unknown as WorkspaceJobInput;
        json(response, 202, this.commands.beginWorkspaceJob(workspaceId, input));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/commands') {
        json(response, 202, commandWireResponse(this.commands.beginCommand(await body(request))));
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
        message === 'VALIDATION_FAILED' || RUNNER_CLIENT_INPUT_ERRORS.has(message)
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

  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization;
    return (
      typeof header === 'string' &&
      header.startsWith('Bearer ') &&
      equalsToken(header.slice(7), this.dependencies.token)
    );
  }
}
