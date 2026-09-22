import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
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
const MAX_WEBSOCKET_FRAME_BYTES = 256 * 1024;
const MAX_WEBSOCKET_BUFFER_BYTES = 1024 * 1024;

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

export class RunnerHttpAdapter
  implements WorkspaceRuntimeControllerPort, WorkspaceRuntimeGatewayPort, AcpTransportPort, BrowserTunnelPort
{
  private readonly baseUrl: URL | null;

  constructor(
    baseUrl: string | undefined,
    private readonly token: string | undefined,
  ) {
    this.baseUrl = baseUrl ? new URL(baseUrl) : null;
    if (this.baseUrl && !['http:', 'https:'].includes(this.baseUrl.protocol))
      throw new Error('AGENT_RUNNER_URL_INVALID');
  }

  async open(request: AcpTransportOpenRequest, signal: AbortSignal): Promise<AcpByteTransport> {
    if (
      !request.workspaceId ||
      request.workspaceId.length > 128 ||
      !Number.isSafeInteger(request.generation) ||
      request.generation < 1 ||
      !/^[a-z][a-z0-9_.-]{0,127}$/.test(request.profileId)
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const socket = await this.openWebSocket(
      `/v1/workspaces/${encodeURIComponent(request.workspaceId)}/acp/${encodeURIComponent(request.profileId)}/stream?generation=${request.generation}`,
      {},
      signal,
    );
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000);
    };
    const readable = new ReadableStream<Uint8Array>({
      start(next) {
        controller = next;
        socket.on('message', (data, isBinary) => {
          if (!isBinary) {
            next.error(new Error('ACP_STREAM_PROTOCOL_INVALID'));
            void close();
            return;
          }
          const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          next.enqueue(new Uint8Array(bytes));
        });
        socket.once('close', () => {
          if (!closed) {
            closed = true;
            next.close();
          }
        });
        socket.once('error', (error) => {
          if (!closed) next.error(error);
        });
      },
      cancel() {
        return close();
      },
    });
    const writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        if (closed || socket.readyState !== WebSocket.OPEN) throw new Error('ACP_STREAM_CLOSED');
        if (socket.bufferedAmount > MAX_WEBSOCKET_BUFFER_BYTES) throw new Error('ACP_STREAM_BACKPRESSURE');
        for (let offset = 0; offset < chunk.byteLength; offset += MAX_WEBSOCKET_FRAME_BYTES) {
          const frame = chunk.subarray(offset, Math.min(offset + MAX_WEBSOCKET_FRAME_BYTES, chunk.byteLength));
          await new Promise<void>((resolve, reject) =>
            socket.send(frame, { binary: true }, (error) => (error ? reject(error) : resolve())),
          );
        }
      },
      close,
      abort: close,
    });
    void controller;
    return { readable, writable, close };
  }

  async openTerminalWebSocket(
    workspaceId: string,
    generation: number,
    columns: number,
    rows: number,
    signal?: AbortSignal,
  ): Promise<WebSocket> {
    if (
      !workspaceId ||
      workspaceId.length > 128 ||
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
    return this.openWebSocket(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/terminal/stream?generation=${generation}&columns=${columns}&rows=${rows}`,
      {},
      signal,
    );
  }

  async openBrowserTunnel(
    endpoint: BrowserEndpointSetting,
    binding: { targetId: string; targetRevision: number; workspaceId?: string; generation?: number },
    signal: AbortSignal,
  ): Promise<BrowserMessageTransport> {
    if (endpoint.via !== 'runner') throw new Error('BROWSER_ENDPOINT_VIA_INVALID');
    if (!binding.targetId || binding.targetId.length > 128 || !Number.isSafeInteger(binding.targetRevision)) {
      throw new Error('VALIDATION_FAILED');
    }
    if ((binding.workspaceId === undefined) !== (binding.generation === undefined)) {
      throw new Error('BROWSER_TUNNEL_BINDING_INVALID');
    }
    const query = new URLSearchParams();
    if (binding.workspaceId) query.set('workspaceId', binding.workspaceId);
    if (binding.generation !== undefined) query.set('generation', String(binding.generation));
    const encodedEndpoint = Buffer.from(JSON.stringify(endpoint), 'utf8').toString('base64url');
    const socket = await this.openWebSocket(
      `/v1/browser/tunnel${query.size ? `?${query.toString()}` : ''}`,
      {
        'X-Nexus-Browser-Endpoint': encodedEndpoint,
        'X-Nexus-Browser-Target': binding.targetId,
        'X-Nexus-Browser-Revision': String(binding.targetRevision),
      },
      signal,
      16 * 1024 * 1024,
    );
    const messageListeners = new Set<(message: string) => void>();
    const closeListeners = new Set<() => void>();
    let closed = false;
    const emitClose = () => {
      if (closed) return;
      closed = true;
      for (const listener of closeListeners) listener();
      closeListeners.clear();
      messageListeners.clear();
    };
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        socket.close(1003);
        emitClose();
        return;
      }
      const message = Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
      for (const listener of messageListeners) listener(message);
    });
    socket.once('close', emitClose);
    socket.once('error', emitClose);
    return {
      send: (message: string) => {
        if (closed || socket.readyState !== WebSocket.OPEN) throw new Error('BROWSER_TRANSPORT_CLOSED');
        if (Buffer.byteLength(message, 'utf8') > 16 * 1024 * 1024) throw new Error('BROWSER_MESSAGE_TOO_LARGE');
        if (socket.bufferedAmount > 16 * 1024 * 1024) throw new Error('BROWSER_TRANSPORT_BACKPRESSURE');
        socket.send(message);
      },
      onMessage: (listener) => {
        messageListeners.add(listener);
        return () => messageListeners.delete(listener);
      },
      onClose: (listener) => {
        closeListeners.add(listener);
        return () => closeListeners.delete(listener);
      },
      close: async () => {
        if (!closed && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
          socket.close(1000);
        }
        emitClose();
      },
    };
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
    return decodeCatalog(await this.get('/v1/catalog', signal));
  }

  async storage(signal?: AbortSignal): Promise<WorkspaceRuntimeStorageView> {
    return decodeStorage(await this.get('/v1/storage', signal));
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
    return decodeWorkspaceJobView(await this.get(`/v1/jobs/${encodeURIComponent(jobId)}`, signal));
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
        { timeoutMs: timeoutMs + 5_000 },
      ),
    );
  }

  async cancelJob(jobId: string, signal?: AbortSignal): Promise<WorkspaceJobView> {
    if (!/^job-[a-f0-9]{64}$/.test(jobId)) throw new Error('VALIDATION_FAILED');
    return decodeWorkspaceJobView(
      await this.request(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: {} }, signal, {
        timeoutMs: 10_000,
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

  private openWebSocket(
    pathname: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    maxPayload = MAX_WEBSOCKET_FRAME_BYTES,
  ): Promise<WebSocket> {
    if (!this.baseUrl || !this.token) return Promise.reject(new Error('WORKSPACE_RUNTIME_UNAVAILABLE'));
    const target = new URL(pathname, this.baseUrl);
    if (target.origin !== this.baseUrl.origin) return Promise.reject(new Error('WORKSPACE_RUNTIME_URL_INVALID'));
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    return new Promise<WebSocket>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new Error('ABORTED'));
        return;
      }
      const socket = new WebSocket(target, {
        perMessageDeflate: false,
        maxPayload,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'X-Nexus-Agent-Protocol': RUNNER_PROTOCOL_VERSION,
          ...headers,
        },
      });
      let settled = false;
      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
        socket.removeListener('open', onOpen);
        socket.removeListener('error', onError);
        socket.removeListener('unexpected-response', onUnexpected);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.once('error', () => undefined);
        socket.terminate();
        reject(error);
      };
      const onOpen = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(socket);
      };
      const onError = (error: Error) => fail(error);
      const onUnexpected = (_request: unknown, response: import('node:http').IncomingMessage) => {
        const rawCode = response.headers['x-nexus-agent-error'];
        const code = typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(rawCode) ? `_${rawCode}` : '';
        response.resume();
        fail(new Error(`WORKSPACE_RUNTIME_WS_${response.statusCode ?? 500}${code}`));
      };
      const onAbort = () => fail(signal?.reason instanceof Error ? signal.reason : new Error('ABORTED'));
      socket.once('open', onOpen);
      socket.once('error', onError);
      socket.once('unexpected-response', onUnexpected);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private get(pathname: string, signal?: AbortSignal): Promise<unknown> {
    return this.request(pathname, { method: 'GET' }, signal);
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
