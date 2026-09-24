import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type WebSocket from 'ws';
import type { ProjectInstructionProjection } from '../../../modules/agent/ai/project-instruction-source.port';
import type {
  AcpByteTransport,
  AcpTransportOpenRequest,
  AcpTransportPort,
  BrowserEndpointSetting,
  BrowserMessageTransport,
  BrowserTunnelPort,
} from '../../../modules/agent/ai/integrations.types';
import type {
  WorkspaceExecutionGrant,
  WorkspaceRuntimeGatewayPort,
  WorkspaceJobCall,
  WorkspaceJobView,
} from '../../../modules/agent/workspace-runtime/workspace-runtime-gateway.port';
import type {
  WorkspaceRuntimeControllerPort,
  AgentWorkspaceReadHandle,
  RunnerCommandRequest,
  RunnerCommandResult,
  WorkspaceApplyPatchRequest,
  WorkspaceApplyPatchResult,
  WorkspaceFileDeleteRequest,
  WorkspaceFileDeleteResult,
  WorkspaceFileListRequest,
  WorkspaceFileListResult,
  WorkspaceFileMoveRequest,
  WorkspaceFileMoveResult,
  WorkspaceFileReadRequest,
  WorkspaceFileReadResult,
  WorkspaceFileStatResult,
  WorkspaceFileWriteRequest,
  WorkspaceFileWriteResult,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
  WorkspaceRepoMapRequest,
  WorkspaceRepoMapResult,
  WorkspaceCodeIntelRequest,
  WorkspaceCodeIntelResult,
} from '../../../modules/agent/workspace-runtime/workspace-runtime-controller.port';
import type {
  WorkspaceRuntimeAvailability,
  WorkspaceRuntimeCatalog,
  WorkspaceRuntimeStorageView,
} from '../../../modules/agent/workspace-runtime/workspace-runtime.types';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_JOB_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_STORAGE_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_CATALOG_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_HOST_WORKSPACE_TRANSFER_BYTES = 256 * 1024 * 1024;
const WORKSPACE_TRANSFER_TIMEOUT_MS = 120_000;
const RUNNER_PROTOCOL_VERSION = '2026-09-13';

const retryableRunnerGetTransportError = (error: unknown): boolean => {
  if (!(error instanceof TypeError)) return false;
  const cause = (error as TypeError & { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return false;
  const code = 'code' in cause ? String((cause as { code?: unknown }).code ?? '') : '';
  return ['UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(code);
};

const timeoutSignal = (
  parent: AbortSignal | undefined,
  milliseconds: number,
): { signal: AbortSignal; dispose(): void } => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('WORKSPACE_RUNTIME_TIMEOUT')), milliseconds);
  const onAbort = () => controller.abort(parent?.reason ?? new Error('ABORTED'));
  if (parent?.aborted) onAbort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
};

import {
  parseRunnerJson,
  decodeAvailability,
  decodeCatalog,
  decodeStorage,
  decodeCommandWireResponse,
  decodeRunnerWorkspaceProjection,
  decodeWorkspaceJobView,
  decodeWrittenBytes,
  decodeProjectInstructionProjection,
  decodeWorkspaceFileRead,
  decodeWorkspaceFileStat,
  decodeWorkspaceFileWrite,
  decodeWorkspaceFileList,
  decodeWorkspaceFileMove,
  decodeWorkspaceFileDelete,
  decodeWorkspaceSearch,
  decodeWorkspaceRepoMap,
  decodeWorkspaceCodeIntel,
  decodeWorkspaceApplyPatch,
  decodeErrorCode,
  commandResult,
} from './runner-http-protocol';
import { RunnerWebSocketTransport } from './runner-websocket-transport';

export class RunnerHttpAdapter
  implements WorkspaceRuntimeControllerPort, WorkspaceRuntimeGatewayPort, AcpTransportPort, BrowserTunnelPort
{
  private readonly baseUrl: URL | null;
  private readonly streams: RunnerWebSocketTransport;

  constructor(
    baseUrl: string | undefined,
    private readonly token: string | undefined,
  ) {
    this.baseUrl = baseUrl ? new URL(baseUrl) : null;
    if (this.baseUrl && !['http:', 'https:'].includes(this.baseUrl.protocol))
      throw new Error('AGENT_RUNNER_URL_INVALID');
    this.streams = new RunnerWebSocketTransport(this.baseUrl, this.token, RUNNER_PROTOCOL_VERSION);
  }

  open(request: AcpTransportOpenRequest, signal: AbortSignal): Promise<AcpByteTransport> {
    return this.streams.open(request, signal);
  }

  openTerminalWebSocket(
    workspaceId: string,
    generation: number,
    columns: number,
    rows: number,
    signal?: AbortSignal,
  ): Promise<WebSocket> {
    return this.streams.openTerminalWebSocket(workspaceId, generation, columns, rows, signal);
  }

  openBrowserTunnel(
    endpoint: BrowserEndpointSetting,
    binding: { targetId: string; targetRevision: number; workspaceId?: string; generation?: number },
    signal: AbortSignal,
  ): Promise<BrowserMessageTransport> {
    return this.streams.openBrowserTunnel(endpoint, binding, signal);
  }

  async availability(signal?: AbortSignal): Promise<WorkspaceRuntimeAvailability> {
    if (!this.baseUrl || !this.token) {
      return {
        available: false,
        reason: 'runner_not_configured',
        mode: 'native',
        isolation: 'logical',
      };
    }
    try {
      return decodeAvailability(await this.get('/v1/availability', signal));
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : 'runner_unavailable',
        mode: 'native',
        isolation: 'logical',
      };
    }
  }

  async catalog(signal?: AbortSignal): Promise<WorkspaceRuntimeCatalog> {
    return decodeCatalog(await this.get('/v1/catalog', signal, { maxResponseBytes: MAX_CATALOG_RESPONSE_BYTES }));
  }

  async storage(signal?: AbortSignal): Promise<WorkspaceRuntimeStorageView> {
    return decodeStorage(await this.get('/v1/storage', signal, { maxResponseBytes: MAX_STORAGE_RESPONSE_BYTES }));
  }

  async submit(command: RunnerCommandRequest, signal?: AbortSignal): Promise<RunnerCommandResult> {
    if (!command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) {
      throw new Error('VALIDATION_FAILED');
    }
    const response = decodeCommandWireResponse(
      await this.request(
        '/v1/commands',
        {
          method: 'POST',
          body: {
            ...command.payload,
            commandId: command.commandId,
            action: command.action,
            ...(['provision', 'start', 'stop', 'restart', 'delete'].includes(command.action)
              ? { generation: command.generation }
              : {}),
            deadlineAt: command.deadlineAt,
          },
        },
        signal,
      ),
    );
    return commandResult(response);
  }

  async query(commandId: string, signal?: AbortSignal): Promise<RunnerCommandResult> {
    if (!/^[A-Za-z0-9-]{8,128}$/.test(commandId)) throw new Error('VALIDATION_FAILED');
    return commandResult(
      decodeCommandWireResponse(await this.get(`/v1/commands/${encodeURIComponent(commandId)}`, signal)),
    );
  }

  async workspaceStatus(workspaceId: string, generation: number, signal?: AbortSignal) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(workspaceId) || !Number.isSafeInteger(generation) || generation < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const projection = decodeRunnerWorkspaceProjection(
      await this.get(`/v1/workspaces/${encodeURIComponent(workspaceId)}/status?generation=${generation}`, signal),
    );
    if (projection.workspaceId !== workspaceId || projection.generation !== generation) {
      throw new Error('WORKSPACE_RUNTIME_PROTOCOL_INVALID');
    }
    return projection;
  }

  async projectInstructions(
    workspaceId: string,
    generation: number,
    targetDirectories: readonly string[],
    signal?: AbortSignal,
  ): Promise<Omit<ProjectInstructionProjection, 'workspaceId' | 'generation'>> {
    if (
      !workspaceId ||
      workspaceId.length > 128 ||
      !Number.isSafeInteger(generation) ||
      generation < 1 ||
      targetDirectories.length > 8 ||
      targetDirectories.some((value) => typeof value !== 'string' || !value || value.length > 4096)
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    return decodeProjectInstructionProjection(
      await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/project-instructions`,
        { method: 'POST', body: { generation, targetDirectories: [...targetDirectories] } },
        signal,
        { maxResponseBytes: 256 * 1024 },
      ),
    );
  }

  async readWorkspaceFile(
    workspaceId: string,
    generation: number,
    request: WorkspaceFileReadRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileReadResult> {
    return decodeWorkspaceFileRead(
      await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/coding/read-file`,
        { method: 'POST', body: { generation, ...request } },
        signal,
        { maxResponseBytes: 128 * 1024 },
      ),
    );
  }

  async statWorkspacePath(
    workspaceId: string,
    generation: number,
    path: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileStatResult> {
    return decodeWorkspaceFileStat(
      await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/coding/stat`,
        { method: 'POST', body: { generation, path } },
        signal,
        { maxResponseBytes: 64 * 1024 },
      ),
    );
  }

  async writeWorkspaceFile(
    workspaceId: string,
    generation: number,
    request: WorkspaceFileWriteRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileWriteResult> {
    return decodeWorkspaceFileWrite(
      await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/coding/write-file`,
        { method: 'POST', body: { generation, ...request } },
        signal,
        { maxResponseBytes: 64 * 1024 },
      ),
    );
  }

  async listWorkspaceFiles(
    workspaceId: string,
    generation: number,
    request: WorkspaceFileListRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileListResult> {
    return decodeWorkspaceFileList(
      await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/coding/list`,
        { method: 'POST', body: { generation, ...request } },
        signal,
        { maxResponseBytes: 256 * 1024 },
      ),
    );
  }

  async moveWorkspaceFile(
    workspaceId: string,
    generation: number,
    request: WorkspaceFileMoveRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileMoveResult> {
    return decodeWorkspaceFileMove(
      await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/coding/move`,
        { method: 'POST', body: { generation, ...request } },
        signal,
        { maxResponseBytes: 64 * 1024 },
      ),
    );
  }

  async deleteWorkspaceFile(
    workspaceId: string,
    generation: number,
    request: WorkspaceFileDeleteRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileDeleteResult> {
    return decodeWorkspaceFileDelete(
      await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/coding/delete`,
        { method: 'POST', body: { generation, ...request } },
        signal,
        { maxResponseBytes: 64 * 1024 },
      ),
    );
  }

  async searchWorkspace(
    workspaceId: string,
    generation: number,
    request: WorkspaceSearchRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceSearchResult> {
    return decodeWorkspaceSearch(
      await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/coding/search`,
        { method: 'POST', body: { generation, ...request } },
        signal,
        { maxResponseBytes: 384 * 1024 },
      ),
    );
  }

  async repoMap(
    workspaceId: string,
    generation: number,
    request: WorkspaceRepoMapRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceRepoMapResult> {
    return decodeWorkspaceRepoMap(
      await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/coding/repo-map`,
        { method: 'POST', body: { generation, ...request } },
        signal,
        { maxResponseBytes: 128 * 1024 },
      ),
    );
  }

  async codeIntel(
    workspaceId: string,
    generation: number,
    request: WorkspaceCodeIntelRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceCodeIntelResult> {
    return decodeWorkspaceCodeIntel(
      await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/coding/code-intel`,
        { method: 'POST', body: { generation, ...request } },
        signal,
        { maxResponseBytes: 128 * 1024 },
      ),
    );
  }

  async applyWorkspacePatch(
    workspaceId: string,
    generation: number,
    request: WorkspaceApplyPatchRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceApplyPatchResult> {
    return decodeWorkspaceApplyPatch(
      await this.request(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/coding/apply-patch`,
        { method: 'POST', body: { generation, ...request } },
        signal,
        { maxResponseBytes: 128 * 1024 },
      ),
    );
  }

  openWorkspaceFileRead(
    workspaceId: string,
    generation: number,
    targetPluginId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<AgentWorkspaceReadHandle> {
    const query = new URLSearchParams({ generation: String(generation), path });
    return this.openWorkspaceRead(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(targetPluginId)}/file?${query.toString()}`,
      signal,
    );
  }

  async writeWorkspaceFileStream(
    workspaceId: string,
    generation: number,
    targetPluginId: string,
    path: string,
    source: AsyncIterable<Uint8Array>,
    expectedBytes: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 0 ||
      expectedBytes > MAX_HOST_WORKSPACE_TRANSFER_BYTES
    ) {
      throw new Error('WORKSPACE_FILE_TOO_LARGE');
    }
    const query = new URLSearchParams({ generation: String(generation), path });
    await this.writeWorkspaceStream(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(targetPluginId)}/file?${query.toString()}`,
      source,
      expectedBytes,
      signal,
    );
  }

  openWorkspaceCheckpointArchive(
    workspaceId: string,
    generation: number,
    signal?: AbortSignal,
  ): Promise<AgentWorkspaceReadHandle> {
    const query = new URLSearchParams({ generation: String(generation) });
    return this.openWorkspaceRead(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/checkpoint/archive?${query.toString()}`,
      signal,
    );
  }

  async restoreWorkspaceCheckpointArchive(
    workspaceId: string,
    generation: number,
    source: AsyncIterable<Uint8Array>,
    expectedBytes: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > MAX_HOST_WORKSPACE_TRANSFER_BYTES
    ) {
      throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_TOO_LARGE');
    }
    const query = new URLSearchParams({ generation: String(generation) });
    await this.writeWorkspaceStream(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/checkpoint/archive?${query.toString()}`,
      source,
      expectedBytes,
      signal,
    );
  }

  async startJob(
    grant: WorkspaceExecutionGrant,
    call: WorkspaceJobCall,
    signal: AbortSignal,
  ): Promise<WorkspaceJobView> {
    const jobId = `job-${call.operationHash.slice(3)}`;
    if (!/^job-[a-f0-9]{64}$/.test(jobId)) throw new Error('VALIDATION_FAILED');
    const createdAt = Math.floor(Date.now() / 1000);
    const deadlineAt = createdAt + Math.ceil(call.timeoutMs / 1000) + 15;
    const request = {
      jobId,
      generation: grant.generation,
      deadlineAt,
      argv: [...call.argv],
      cwd: call.cwd,
      maxBytes: call.maxBytes,
      timeoutMs: call.timeoutMs,
    };
    try {
      return decodeWorkspaceJobView(
        await this.request(
          `/v1/workspaces/${encodeURIComponent(grant.workspaceId)}/jobs`,
          { method: 'POST', body: request },
          signal,
          { maxResponseBytes: MAX_JOB_RESPONSE_BYTES },
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'WORKSPACE_JOB_ACTIVE_CONFLICT') throw error;
      try {
        return await this.queryJob(jobId);
      } catch {
        return {
          jobId,
          workspaceId: grant.workspaceId,
          generation: grant.generation,
          status: 'unknown',
          result: null,
          error: signal.aborted
            ? 'WORKSPACE_JOB_OUTCOME_UNKNOWN'
            : error instanceof Error
              ? error.message.slice(0, 256)
              : 'WORKSPACE_JOB_OUTCOME_UNKNOWN',
          createdAt,
          completedAt: Math.floor(Date.now() / 1000),
        };
      }
    }
  }

  async invoke(grant: WorkspaceExecutionGrant, call: WorkspaceJobCall, signal: AbortSignal): Promise<WorkspaceJobView> {
    const current = await this.startJob(grant, call, signal);
    if (current.status !== 'pending' && current.status !== 'running') return current;
    const waitMs = Math.min(5 * 60 * 1000, call.timeoutMs + 15_000);
    try {
      const terminal = await this.waitJob(current.jobId, waitMs, signal);
      if (terminal.status !== 'pending' && terminal.status !== 'running') return terminal;
      return {
        ...terminal,
        status: 'unknown',
        result: null,
        error: 'WORKSPACE_JOB_QUERY_TIMEOUT',
        completedAt: Math.floor(Date.now() / 1000),
      };
    } catch {
      const final = await this.queryJob(current.jobId).catch(() => null);
      if (final && final.status !== 'pending' && final.status !== 'running') return final;
      return {
        ...current,
        status: 'unknown',
        result: null,
        error: 'WORKSPACE_JOB_OUTCOME_UNKNOWN',
        completedAt: Math.floor(Date.now() / 1000),
      };
    }
  }

  async queryJob(jobId: string, signal?: AbortSignal): Promise<WorkspaceJobView> {
    if (!/^job-[a-f0-9]{64}$/.test(jobId)) throw new Error('VALIDATION_FAILED');
    return decodeWorkspaceJobView(
      await this.get(`/v1/jobs/${encodeURIComponent(jobId)}`, signal, { maxResponseBytes: MAX_JOB_RESPONSE_BYTES }),
    );
  }

  async waitJob(jobId: string, timeoutMs: number, signal?: AbortSignal): Promise<WorkspaceJobView> {
    if (
      !/^job-[a-f0-9]{64}$/.test(jobId) ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 5 * 60 * 1000
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    return decodeWorkspaceJobView(
      await this.request(
        `/v1/jobs/${encodeURIComponent(jobId)}/wait`,
        { method: 'POST', body: { timeoutMs } },
        signal,
        { timeoutMs: timeoutMs + 5_000, maxResponseBytes: MAX_JOB_RESPONSE_BYTES },
      ),
    );
  }

  async cancelJob(jobId: string, signal?: AbortSignal): Promise<WorkspaceJobView> {
    if (!/^job-[a-f0-9]{64}$/.test(jobId)) throw new Error('VALIDATION_FAILED');
    return decodeWorkspaceJobView(
      await this.request(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: {} }, signal, {
        timeoutMs: 10_000,
        maxResponseBytes: MAX_JOB_RESPONSE_BYTES,
      }),
    );
  }

  private async openWorkspaceRead(pathname: string, parentSignal?: AbortSignal): Promise<AgentWorkspaceReadHandle> {
    if (!this.baseUrl || !this.token) throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
    const target = new URL(pathname, this.baseUrl);
    if (target.origin !== this.baseUrl.origin) throw new Error('WORKSPACE_RUNTIME_URL_INVALID');
    const scoped = timeoutSignal(parentSignal, WORKSPACE_TRANSFER_TIMEOUT_MS);
    let response: Response | null = null;
    try {
      response = await fetch(target, {
        method: 'GET',
        headers: {
          Accept: 'application/octet-stream',
          'X-Nexus-Agent-Protocol': RUNNER_PROTOCOL_VERSION,
          Authorization: `Bearer ${this.token}`,
        },
        signal: scoped.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        const text = (await response.text()).slice(0, 4096);
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'WORKSPACE_RUNTIME_AUTH_FAILED'
            : response.status === 413
              ? 'WORKSPACE_FILE_TOO_LARGE'
              : `WORKSPACE_RUNTIME_HTTP_${response.status}${text ? `:${text}` : ''}`,
        );
      }
      if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/octet-stream')) {
        throw new Error('WORKSPACE_STREAM_INVALID');
      }
      const rawLength = response.headers.get('content-length');
      if (!rawLength || !/^\d+$/.test(rawLength)) throw new Error('WORKSPACE_STREAM_INVALID');
      const declared = Number(rawLength);
      if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_HOST_WORKSPACE_TRANSFER_BYTES) {
        throw new Error('WORKSPACE_FILE_TOO_LARGE');
      }
      if (!response.body && declared !== 0) throw new Error('WORKSPACE_STREAM_INVALID');
      const streamResponse = response;
      let closed = false;
      const close = async (): Promise<void> => {
        if (closed) return;
        closed = true;
        scoped.dispose();
        await streamResponse.body?.cancel().catch(() => undefined);
      };
      const source = (async function* (): AsyncIterable<Uint8Array> {
        let received = 0;
        const reader = streamResponse.body?.getReader();
        try {
          if (reader) {
            while (true) {
              const next = await reader.read();
              if (next.done) break;
              received += next.value.byteLength;
              if (received > declared || received > MAX_HOST_WORKSPACE_TRANSFER_BYTES) {
                throw new Error('WORKSPACE_STREAM_INVALID');
              }
              yield next.value;
            }
          }
          if (received !== declared) throw new Error('WORKSPACE_STREAM_INVALID');
        } finally {
          reader?.releaseLock();
          await close();
        }
      })();
      return { sizeBytes: declared, source, close };
    } catch (error) {
      await response?.body?.cancel().catch(() => undefined);
      scoped.dispose();
      throw error;
    }
  }

  private async writeWorkspaceStream(
    pathname: string,
    source: AsyncIterable<Uint8Array>,
    expectedBytes: number,
    parentSignal?: AbortSignal,
  ): Promise<void> {
    if (!this.baseUrl || !this.token) throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
    const target = new URL(pathname, this.baseUrl);
    if (target.origin !== this.baseUrl.origin) throw new Error('WORKSPACE_RUNTIME_URL_INVALID');
    const scoped = timeoutSignal(parentSignal, WORKSPACE_TRANSFER_TIMEOUT_MS);
    const body = Readable.from(source);
    try {
      const response = await fetch(target, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(expectedBytes),
          'X-Nexus-Agent-Protocol': RUNNER_PROTOCOL_VERSION,
          Authorization: `Bearer ${this.token}`,
        },
        body,
        duplex: 'half',
        signal: scoped.signal,
        redirect: 'error',
      } as unknown as RequestInit & { duplex: 'half' });
      if (!response.ok) {
        const text = (await response.text()).slice(0, 4096);
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'WORKSPACE_RUNTIME_AUTH_FAILED'
            : response.status === 413
              ? 'WORKSPACE_FILE_TOO_LARGE'
              : `WORKSPACE_RUNTIME_HTTP_${response.status}${text ? `:${text}` : ''}`,
        );
      }
      const text = (await response.text()).slice(0, 4096);
      if (text) {
        let writtenBytes: number;
        try {
          writtenBytes = decodeWrittenBytes(parseRunnerJson(text));
        } catch {
          throw new Error('WORKSPACE_STREAM_INVALID');
        }
        if (writtenBytes !== expectedBytes) throw new Error('WORKSPACE_STREAM_INVALID');
      }
    } finally {
      body.destroy();
      scoped.dispose();
    }
  }

  private get(
    pathname: string,
    signal?: AbortSignal,
    limits: { timeoutMs?: number; maxResponseBytes?: number } = {},
  ): Promise<unknown> {
    return this.request(pathname, { method: 'GET' }, signal, limits);
  }

  private async request(
    pathname: string,
    input: { method: 'GET' | 'POST'; body?: unknown },
    parentSignal?: AbortSignal,
    limits: { timeoutMs?: number; maxResponseBytes?: number } = {},
  ): Promise<unknown> {
    if (!this.baseUrl || !this.token) throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
    const target = new URL(pathname, this.baseUrl);
    if (target.origin !== this.baseUrl.origin) throw new Error('WORKSPACE_RUNTIME_URL_INVALID');
    const scoped = timeoutSignal(parentSignal, limits.timeoutMs ?? 10_000);
    const attempts = input.method === 'GET' ? 3 : 1;
    try {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const response = await fetch(target, {
            method: input.method,
            headers: {
              Accept: 'application/json',
              'X-Nexus-Agent-Protocol': RUNNER_PROTOCOL_VERSION,
              Authorization: `Bearer ${this.token}`,
              ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
            signal: scoped.signal,
            redirect: 'error',
          });
          if (!response.ok) {
            const text = (await response.text()).slice(0, 4096);
            if (response.status === 409) {
              try {
                const code = decodeErrorCode(parseRunnerJson(text));
                if (code) throw new Error(code);
              } catch (error) {
                if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) throw error;
              }
            }
            throw new Error(
              response.status === 401 || response.status === 403
                ? 'WORKSPACE_RUNTIME_AUTH_FAILED'
                : `WORKSPACE_RUNTIME_HTTP_${response.status}${text ? `:${text}` : ''}`,
            );
          }
          const maxResponseBytes = limits.maxResponseBytes ?? MAX_RESPONSE_BYTES;
          const declared = Number(response.headers.get('content-length') ?? '0');
          if (Number.isFinite(declared) && declared > maxResponseBytes)
            throw new Error('WORKSPACE_RUNTIME_RESPONSE_TOO_LARGE');
          const text = await response.text();
          if (Buffer.byteLength(text, 'utf8') > maxResponseBytes)
            throw new Error('WORKSPACE_RUNTIME_RESPONSE_TOO_LARGE');
          return parseRunnerJson(text);
        } catch (error) {
          if (
            input.method !== 'GET' ||
            attempt === attempts ||
            scoped.signal.aborted ||
            !retryableRunnerGetTransportError(error)
          ) {
            throw error;
          }
          await delay(100 * attempt, undefined, { signal: scoped.signal });
        }
      }
      throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
    } finally {
      scoped.dispose();
    }
  }
}
