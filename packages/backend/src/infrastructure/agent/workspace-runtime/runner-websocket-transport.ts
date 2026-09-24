import WebSocket from 'ws';
import type {
  AcpByteTransport,
  AcpTransportOpenRequest,
  AcpTransportPort,
  BrowserEndpointSetting,
  BrowserMessageTransport,
  BrowserTunnelPort,
} from '../../../modules/agent/ai/integrations.types';
import { invokeListenerSafely } from '../../../shared/events/safe-event-dispatch';

const MAX_WEBSOCKET_FRAME_BYTES = 256 * 1024;
const MAX_WEBSOCKET_BUFFER_BYTES = 1024 * 1024;

export class RunnerWebSocketTransport implements AcpTransportPort, BrowserTunnelPort {
  constructor(
    private readonly baseUrl: URL | null,
    private readonly token: string | undefined,
    private readonly protocolVersion: string,
  ) {}

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
      for (const listener of closeListeners) invokeListenerSafely(listener);
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
      for (const listener of messageListeners) invokeListenerSafely(listener, message);
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
          'X-Nexus-Agent-Protocol': this.protocolVersion,
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
}
