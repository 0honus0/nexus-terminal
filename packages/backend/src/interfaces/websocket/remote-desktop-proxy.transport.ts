import WebSocket, { type RawData } from 'ws';

const MAX_PENDING_CLIENT_BYTES = 1024 * 1024;
const CONNECT_TIMEOUT_MS = 15_000;

export interface RemoteDesktopProxyRequest {
  token: string;
  width: number;
  height: number;
  dpi: number;
}

const rawSize = (message: RawData): number =>
  Array.isArray(message) ? message.reduce((total, chunk) => total + chunk.byteLength, 0) : message.byteLength;

const isClosingOrClosed = (readyState: WebSocket['readyState']): boolean =>
  readyState === WebSocket.CLOSING || readyState === WebSocket.CLOSED;

/** Transparent Guacamole tunnel proxy. It owns only WebSocket forwarding/backpressure. */
export const proxyRemoteDesktop = (
  client: WebSocket,
  remoteGatewayWsBaseUrl: string,
  request: RemoteDesktopProxyRequest,
): void => {
  const base = remoteGatewayWsBaseUrl.replace(/\/+$/, '');
  const dpi = request.dpi;
  const target = new URL(`${base}/`);
  target.searchParams.set('token', request.token);
  target.searchParams.set('width', String(request.width));
  target.searchParams.set('height', String(request.height));
  target.searchParams.set('dpi', String(dpi));
  target.searchParams.set('GUAC_AUDIO', 'audio/L16');

  const upstream = new WebSocket(target.toString());
  const pending: Array<{ message: RawData; binary: boolean; size: number }> = [];
  let pendingBytes = 0;
  let clientClosed = false;
  let upstreamClosed = false;
  const timeout = setTimeout(() => {
    if (upstream.readyState !== WebSocket.CONNECTING) return;
    upstream.terminate();
    upstreamClosed = true;
    if (client.readyState === WebSocket.OPEN) {
      client.close(1013, 'Remote desktop gateway timeout');
      clientClosed = true;
    }
  }, CONNECT_TIMEOUT_MS);
  timeout.unref?.();

  client.on('message', (message, isBinary) => {
    const text = isBinary ? null : message.toString();
    if (text && /^(?:\d+\.)?connect[,;]/.test(text)) return;
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(message, { binary: isBinary });
      return;
    }
    if (upstream.readyState !== WebSocket.CONNECTING) return;
    const size = rawSize(message);
    if (pendingBytes + size > MAX_PENDING_CLIENT_BYTES) {
      client.close(1009, 'Remote desktop pending queue exceeded');
      clientClosed = true;
      return;
    }
    pending.push({ message, binary: isBinary, size });
    pendingBytes += size;
  });

  upstream.on('message', (message, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(message, { binary: isBinary });
  });
  upstream.on('open', () => {
    clearTimeout(timeout);
    for (const item of pending.splice(0)) {
      if (upstream.readyState !== WebSocket.OPEN) break;
      upstream.send(item.message, { binary: item.binary });
      pendingBytes -= item.size;
    }
  });
  upstream.on('error', (error) => {
    clearTimeout(timeout);
    upstreamClosed = true;
    if (!clientClosed && client.readyState === WebSocket.OPEN) {
      client.close(1011, `Remote desktop gateway error: ${error.message}`);
      clientClosed = true;
    }
  });
  client.on('error', () => {
    clientClosed = true;
    if (!upstreamClosed && upstream.readyState !== WebSocket.CLOSED && upstream.readyState !== WebSocket.CLOSING) {
      upstream.close(1011, 'Client WebSocket error');
      upstreamClosed = true;
    }
  });
  client.on('close', () => {
    clearTimeout(timeout);
    clientClosed = true;
    if (!upstreamClosed && upstream.readyState !== WebSocket.CLOSED && upstream.readyState !== WebSocket.CLOSING) {
      upstream.close(1000, 'Client WebSocket closed');
      upstreamClosed = true;
    }
  });
  upstream.on('close', () => {
    clearTimeout(timeout);
    upstreamClosed = true;
    if (!clientClosed && client.readyState !== WebSocket.CLOSED && client.readyState !== WebSocket.CLOSING) {
      client.close(1000, 'Remote desktop gateway closed');
      clientClosed = true;
    }
  });
};
