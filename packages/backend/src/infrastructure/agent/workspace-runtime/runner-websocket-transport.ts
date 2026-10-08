import WebSocket from 'ws';

const MAX_WEBSOCKET_FRAME_BYTES = 256 * 1024;

export class RunnerWebSocketTransport {
  constructor(
    private readonly baseUrl: URL | null,
    private readonly token: string | undefined,
    private readonly protocolVersion: string,
  ) {}

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
