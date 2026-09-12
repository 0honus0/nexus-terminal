import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import type { WorkspaceBrowserEndpoint } from '../types';
import type { RunnerJournal } from './journal';

const MAX_CDP_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const DISCOVERY_MAX_BYTES = 64 * 1024;
const DISCOVERY_TIMEOUT_MS = 10_000;

interface ActiveTunnel {
  client: WebSocket;
  target: WebSocket;
  workspaceId: string | null;
  generation: number | null;
}

const rawText = (data: RawData): string => {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
};

const validateEndpoint = (endpoint: WorkspaceBrowserEndpoint): URL => {
  if (endpoint.via !== 'runner') throw new Error('BROWSER_TUNNEL_VIA_INVALID');
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
    url.hash
  ) {
    throw new Error('BROWSER_ENDPOINT_INVALID');
  }
  const plaintext = url.protocol === 'http:' || url.protocol === 'ws:';
  if (plaintext && !endpoint.allowPlaintext) throw new Error('BROWSER_ENDPOINT_PLAINTEXT_DENIED');
  return url;
};

const readDiscovery = (url: URL, verifyTls: boolean): Promise<string> =>
  new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      url,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Connection: 'close' },
        ...(url.protocol === 'https:' ? { rejectUnauthorized: verifyTls } : {}),
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`BROWSER_ENDPOINT_DISCOVERY_HTTP_${response.statusCode ?? 500}`));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > DISCOVERY_MAX_BYTES) {
            request.destroy(new Error('BROWSER_ENDPOINT_DISCOVERY_TOO_LARGE'));
            return;
          }
          chunks.push(buffer);
        });
        response.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      },
    );
    request.setTimeout(DISCOVERY_TIMEOUT_MS, () => request.destroy(new Error('BROWSER_ENDPOINT_DISCOVERY_TIMEOUT')));
    request.once('error', reject);
    request.end();
  });

const resolveWebSocketUrl = async (endpoint: WorkspaceBrowserEndpoint): Promise<URL> => {
  const configured = validateEndpoint(endpoint);
  if (configured.protocol === 'ws:' || configured.protocol === 'wss:') return configured;
  const discovery = new URL('/json/version', configured);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readDiscovery(discovery, endpoint.verifyTls));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('BROWSER_')) throw error;
    throw new Error('BROWSER_ENDPOINT_DISCOVERY_INVALID');
  }
  const raw =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).webSocketDebuggerUrl
      : undefined;
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 8192) {
    throw new Error('BROWSER_ENDPOINT_DISCOVERY_INVALID');
  }
  let discovered: URL;
  try {
    discovered = new URL(raw);
  } catch {
    throw new Error('BROWSER_ENDPOINT_DISCOVERY_INVALID');
  }
  if (!['ws:', 'wss:'].includes(discovered.protocol) || discovered.username || discovered.password) {
    throw new Error('BROWSER_ENDPOINT_DISCOVERY_INVALID');
  }
  // Chrome commonly advertises localhost/0.0.0.0 even when discovery was reached through
  // a Docker service name. Preserve only the discovered DevTools path/query and pin the
  // authority to the administrator-configured endpoint so discovery cannot redirect the tunnel.
  discovered.protocol = configured.protocol === 'https:' ? 'wss:' : 'ws:';
  discovered.hostname = configured.hostname;
  discovered.port = configured.port;
  return discovered;
};

export class BrowserTunnelRuntime {
  private readonly tunnels = new Set<ActiveTunnel>();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CDP_MESSAGE_BYTES });

  constructor(private readonly journal: RunnerJournal) {}

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    endpoint: WorkspaceBrowserEndpoint,
    binding: { targetId: string; targetRevision: number; workspaceId?: string; generation?: number },
  ): void {
    void this.accept(request, socket, head, endpoint, binding).catch((error) => {
      if (socket.destroyed) return;
      const code = error instanceof Error ? error.message : 'BROWSER_TUNNEL_FAILED';
      socket.end(
        `HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n${JSON.stringify({ error: code.slice(0, 128) })}`,
      );
    });
  }

  closeWorkspace(workspaceId: string, generation: number): void {
    for (const tunnel of [...this.tunnels]) {
      if (tunnel.workspaceId === workspaceId && tunnel.generation === generation) this.closeTunnel(tunnel);
    }
  }

  closeAll(): void {
    for (const tunnel of [...this.tunnels]) this.closeTunnel(tunnel);
  }

  private async accept(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    endpoint: WorkspaceBrowserEndpoint,
    binding: { targetId: string; targetRevision: number; workspaceId?: string; generation?: number },
  ): Promise<void> {
    const workspaceId = binding.workspaceId ?? null;
    const generation = binding.generation ?? null;
    if ((workspaceId === null) !== (generation === null)) throw new Error('BROWSER_TUNNEL_BINDING_INVALID');
    if (workspaceId && generation) {
      const workspace = this.journal.workspace(workspaceId);
      if (!workspace || workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');
      if (workspace.generation !== generation) throw new Error('WORKSPACE_GENERATION_CONFLICT');
      const target = workspace.browserTarget;
      if (
        !target ||
        target.id !== binding.targetId ||
        target.profileRevision !== binding.targetRevision ||
        !target.endpoints.some(
          (candidate) =>
            candidate.via === 'runner' &&
            candidate.scope === endpoint.scope &&
            candidate.url === endpoint.url &&
            candidate.priority === endpoint.priority &&
            candidate.allowPlaintext === endpoint.allowPlaintext &&
            candidate.verifyTls === endpoint.verifyTls,
        )
      ) {
        throw new Error('BROWSER_WORKSPACE_TARGET_STALE');
      }
    }
    const targetUrl = await resolveWebSocketUrl(endpoint);
    const target = new WebSocket(targetUrl, {
      perMessageDeflate: false,
      maxPayload: MAX_CDP_MESSAGE_BYTES,
      rejectUnauthorized: endpoint.verifyTls,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => target.terminate(), DISCOVERY_TIMEOUT_MS);
      const cleanup = () => clearTimeout(timer);
      target.once('open', () => {
        cleanup();
        resolve();
      });
      target.once('error', (error) => {
        cleanup();
        reject(error);
      });
      target.once('close', () => cleanup());
    });
    if (socket.destroyed) {
      target.close();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (client) => {
      const tunnel: ActiveTunnel = { client, target, workspaceId, generation };
      this.tunnels.add(tunnel);
      const close = () => this.closeTunnel(tunnel);
      client.on('message', (data, isBinary) => {
        if (isBinary || target.readyState !== WebSocket.OPEN || target.bufferedAmount > MAX_BUFFERED_BYTES) {
          close();
          return;
        }
        const message = rawText(data);
        if (Buffer.byteLength(message, 'utf8') > MAX_CDP_MESSAGE_BYTES) {
          close();
          return;
        }
        target.send(message);
      });
      target.on('message', (data, isBinary) => {
        if (isBinary || client.readyState !== WebSocket.OPEN || client.bufferedAmount > MAX_BUFFERED_BYTES) {
          close();
          return;
        }
        const message = rawText(data);
        if (Buffer.byteLength(message, 'utf8') > MAX_CDP_MESSAGE_BYTES) {
          close();
          return;
        }
        client.send(message);
      });
      client.once('close', close);
      client.once('error', close);
      target.once('close', close);
      target.once('error', close);
    });
  }

  private closeTunnel(tunnel: ActiveTunnel): void {
    if (!this.tunnels.delete(tunnel)) return;
    if (tunnel.client.readyState === WebSocket.OPEN || tunnel.client.readyState === WebSocket.CONNECTING) {
      tunnel.client.close(1000);
    }
    if (tunnel.target.readyState === WebSocket.OPEN || tunnel.target.readyState === WebSocket.CONNECTING) {
      tunnel.target.close(1000);
    }
  }
}
