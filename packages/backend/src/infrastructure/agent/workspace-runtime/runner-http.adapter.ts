import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { JsonValue, Scope } from '../../../modules/agent/agent.types';
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
} from '../../../modules/agent/workspace-runtime/workspace-runtime-controller.port';
import type {
  WorkspaceRuntimeAvailability,
  WorkspaceRuntimeCatalog,
  WorkspaceRuntimeStorageView,
  PluginWorkspaceGrantSet,
  PluginWorkspaceGrantInput,
} from '../../../modules/agent/workspace-runtime/workspace-runtime.types';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_HOST_WORKSPACE_TRANSFER_BYTES = 256 * 1024 * 1024;
const WORKSPACE_TRANSFER_TIMEOUT_MS = 120_000;
const API_VERSION = '2026-09-11';

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

const jsonValue = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

interface RunnerCommandWireResponse {
  commandId: string;
  status: RunnerCommandResult['status'];
  result?: unknown;
  error?: unknown;
}

const commandResult = (value: RunnerCommandWireResponse): RunnerCommandResult => ({
  commandId: value.commandId,
  status: value.status,
  result:
    value.result !== undefined && value.result !== null
      ? jsonValue(value.result)
      : typeof value.error === 'string' && value.error
        ? { errorCode: value.error.slice(0, 1024) }
        : null,
});

const waitForJob = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('ABORTED'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('ABORTED'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export class RunnerHttpAdapter implements WorkspaceRuntimeControllerPort, WorkspaceRuntimeGatewayPort {
  private readonly baseUrl: URL | null;

  constructor(
    baseUrl: string | undefined,
    private readonly token: string | undefined,
  ) {
    this.baseUrl = baseUrl ? new URL(baseUrl) : null;
    if (this.baseUrl && !['http:', 'https:'].includes(this.baseUrl.protocol))
      throw new Error('AGENT_RUNNER_URL_INVALID');
  }

  async availability(signal?: AbortSignal): Promise<WorkspaceRuntimeAvailability> {
    if (!this.baseUrl || !this.token) {
      return {
        available: false,
        state: 'unavailable',
        reason: 'runner_not_configured',
        deploymentId: null,
        controllerVersion: null,
        sandbox: { available: false, reason: 'runner_not_configured' },
        capabilities: { egressAllowlist: false },
      };
    }
    try {
      return await this.get<WorkspaceRuntimeAvailability>('/v1/availability', signal);
    } catch (error) {
      return {
        available: false,
        state: 'unavailable',
        reason: error instanceof Error ? error.message : 'runner_unavailable',
        deploymentId: null,
        controllerVersion: null,
        sandbox: { available: false, reason: 'runner_unavailable' },
        capabilities: { egressAllowlist: false },
      };
    }
  }

  catalog(signal?: AbortSignal): Promise<WorkspaceRuntimeCatalog> {
    return this.get('/v1/catalog', signal);
  }

  storage(signal?: AbortSignal): Promise<WorkspaceRuntimeStorageView> {
    return this.get('/v1/storage', signal);
  }

  async submit(command: RunnerCommandRequest, signal?: AbortSignal): Promise<RunnerCommandResult> {
    if (!command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)) {
      throw new Error('VALIDATION_FAILED');
    }
    const response = await this.request<RunnerCommandWireResponse>(
      '/v1/commands',
      {
        method: 'POST',
        body: {
          ...command.payload,
          commandId: command.commandId,
          operationHash: command.operationHash,
          action: command.action,
          generation: command.generation,
          deadlineAt: command.deadlineAt,
        },
      },
      signal,
    );
    return commandResult(response);
  }

  async query(commandId: string, signal?: AbortSignal): Promise<RunnerCommandResult> {
    if (!/^[A-Za-z0-9-]{8,128}$/.test(commandId)) throw new Error('VALIDATION_FAILED');
    return commandResult(
      await this.get<RunnerCommandWireResponse>(`/v1/commands/${encodeURIComponent(commandId)}`, signal),
    );
  }

  async workspaceGrants(
    workspaceId: string,
    generation: number,
    targetPluginId: string,
    signal?: AbortSignal,
  ): Promise<PluginWorkspaceGrantSet> {
    const result = await this.get<{ targetPluginId: string } & PluginWorkspaceGrantSet>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(targetPluginId)}/grants?generation=${generation}`,
      signal,
    );
    return { revision: result.revision, grants: result.grants };
  }

  async replaceWorkspaceGrants(
    workspaceId: string,
    generation: number,
    targetPluginId: string,
    grants: readonly PluginWorkspaceGrantInput[],
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<PluginWorkspaceGrantSet> {
    const result = await this.request<{ targetPluginId: string } & PluginWorkspaceGrantSet>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/plugins/${encodeURIComponent(targetPluginId)}/grants`,
      { method: 'POST', body: { generation, grants, expectedRevision } },
      signal,
    );
    return { revision: result.revision, grants: result.grants };
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

  async invoke(grant: WorkspaceExecutionGrant, call: WorkspaceJobCall, signal: AbortSignal): Promise<WorkspaceJobView> {
    const jobId = `job-${call.operationHash.slice(3)}`;
    const issuedAt = Math.floor(Date.now() / 1000);
    const deadlineAt = issuedAt + Math.ceil(call.timeoutMs / 1000) + 15;
    const request = {
      jobId,
      workspaceId: grant.workspaceId,
      generation: grant.generation,
      userId: grant.userId,
      appId: grant.appId,
      runId: grant.runId,
      agentRuntimeId: grant.agentRuntimeId,
      operationHash: call.operationHash,
      issuedAt,
      deadlineAt,
      nonce: randomUUID(),
      argv: [...call.argv],
      cwd: call.cwd,
      maxBytes: call.maxBytes,
      timeoutMs: call.timeoutMs,
    };

    let current: WorkspaceJobView;
    try {
      current = await this.request<WorkspaceJobView>(
        `/v1/workspaces/${encodeURIComponent(grant.workspaceId)}/jobs`,
        { method: 'POST', body: request },
        signal,
      );
    } catch (error) {
      if (signal.aborted) {
        return {
          jobId,
          workspaceId: grant.workspaceId,
          generation: grant.generation,
          status: 'unknown',
          result: null,
          error: 'WORKSPACE_JOB_OUTCOME_UNKNOWN',
          createdAt: issuedAt,
          completedAt: Math.floor(Date.now() / 1000),
        };
      }
      try {
        current = await this.queryJob(jobId);
      } catch {
        return {
          jobId,
          workspaceId: grant.workspaceId,
          generation: grant.generation,
          status: 'unknown',
          result: null,
          error: error instanceof Error ? error.message.slice(0, 256) : 'WORKSPACE_JOB_OUTCOME_UNKNOWN',
          createdAt: issuedAt,
          completedAt: Math.floor(Date.now() / 1000),
        };
      }
    }

    while (current.status === 'pending' || current.status === 'running') {
      if (signal.aborted) {
        const final = await this.queryJob(jobId).catch(() => null);
        if (final && !['pending', 'running'].includes(final.status)) return final;
        return {
          ...current,
          status: 'unknown',
          result: null,
          error: 'WORKSPACE_JOB_OUTCOME_UNKNOWN',
          completedAt: Math.floor(Date.now() / 1000),
        };
      }
      if (Math.floor(Date.now() / 1000) > deadlineAt) {
        return {
          ...current,
          status: 'unknown',
          result: null,
          error: 'WORKSPACE_JOB_QUERY_TIMEOUT',
          completedAt: Math.floor(Date.now() / 1000),
        };
      }
      await waitForJob(250, signal).catch(() => undefined);
      if (!signal.aborted) current = await this.queryJob(jobId, signal);
    }
    return current;
  }

  queryJob(jobId: string, signal?: AbortSignal): Promise<WorkspaceJobView> {
    if (!/^job-[a-f0-9]{64}$/.test(jobId)) throw new Error('VALIDATION_FAILED');
    return this.get(`/v1/jobs/${encodeURIComponent(jobId)}`, signal);
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
          'X-Nexus-Agent-Protocol': API_VERSION,
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
          'X-Nexus-Agent-Protocol': API_VERSION,
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
        let parsed: { writtenBytes?: unknown };
        try {
          parsed = JSON.parse(text) as { writtenBytes?: unknown };
        } catch {
          throw new Error('WORKSPACE_STREAM_INVALID');
        }
        if (parsed.writtenBytes !== expectedBytes) throw new Error('WORKSPACE_STREAM_INVALID');
      }
    } finally {
      body.destroy();
      scoped.dispose();
    }
  }

  private get<T>(pathname: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>(pathname, { method: 'GET' }, signal);
  }

  private async request<T>(
    pathname: string,
    input: { method: 'GET' | 'POST'; body?: unknown },
    parentSignal?: AbortSignal,
    limits: { timeoutMs?: number; maxResponseBytes?: number } = {},
  ): Promise<T> {
    if (!this.baseUrl || !this.token) throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
    const target = new URL(pathname, this.baseUrl);
    if (target.origin !== this.baseUrl.origin) throw new Error('WORKSPACE_RUNTIME_URL_INVALID');
    const scoped = timeoutSignal(parentSignal, limits.timeoutMs ?? 10_000);
    try {
      const response = await fetch(target, {
        method: input.method,
        headers: {
          Accept: 'application/json',
          'X-Nexus-Agent-Protocol': API_VERSION,
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
            const parsed = JSON.parse(text) as { error?: unknown };
            if (typeof parsed.error === 'string' && /^[A-Z][A-Z0-9_]+$/.test(parsed.error)) {
              throw new Error(parsed.error);
            }
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
      if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) throw new Error('WORKSPACE_RUNTIME_RESPONSE_TOO_LARGE');
      return JSON.parse(text) as T;
    } finally {
      scoped.dispose();
    }
  }
}
