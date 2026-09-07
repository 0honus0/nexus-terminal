import http from 'node:http';
import type { Socket } from 'node:net';
import express, { type Request, type RequestHandler, type Response } from 'express';
import ipaddr from 'ipaddr.js';
import WebSocket, { WebSocketServer } from 'ws';
import type { IpWhitelistService } from '../../modules/auth/ip-whitelist.service';
import { proxyRemoteDesktop } from './remote-desktop-proxy.transport';
import { bindUploadStream } from './upload-stream.transport';
import { WorkspaceProtocolSession, type WorkspaceProtocolDependencies } from './workspace-protocol.session';

const ALLOWED_PATHS = new Set(['/ws/workspace', '/ws/uploads', '/ws/remote-desktop']);
const SAFE_WORKSPACE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_MISSED_HEARTBEATS = 2;

interface SessionRequest extends Request {
  session: Request['session'];
}

interface ClientRecord {
  socket: WebSocket;
  kind: 'workspace' | 'upload' | 'remote-desktop';
  protocol?: WorkspaceProtocolSession;
  isAlive: boolean;
  missed: number;
}

export interface WebSocketServerDependencies extends WorkspaceProtocolDependencies {
  ipWhitelist: IpWhitelistService;
}

export interface WebSocketRuntimeOptions {
  remoteGatewayWsBaseUrl: string;
  allowOriginlessWebSockets: boolean;
  passkeyRelyingParties: readonly { origin: string }[];
}

export interface WebSocketServerOptions {
  server: http.Server;
  sessionMiddleware: RequestHandler;
  config: WebSocketRuntimeOptions;
  dependencies: WebSocketServerDependencies;
}

export interface BackendWebSocketServer {
  close(): Promise<void>;
}

const firstHeaderValue = (value: string | string[] | undefined): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw
    ?.split(',')
    .map((item) => item.trim())
    .find(Boolean);
};

/** Forwarded client-address headers are honored only when the TCP peer itself is trusted. */
const isTrustedProxyAddress = (address: string | undefined): boolean => {
  if (!address) return false;
  try {
    return ['loopback', 'private', 'linkLocal', 'uniqueLocal'].includes(ipaddr.process(address).range());
  } catch {
    return false;
  }
};

const resolveClientIp = (request: http.IncomingMessage): string => {
  const remote = request.socket.remoteAddress;
  if (!isTrustedProxyAddress(remote)) return remote || 'unknown';
  return (
    firstHeaderValue(request.headers['x-real-ip']) ||
    firstHeaderValue(request.headers['x-forwarded-for']) ||
    remote ||
    'unknown'
  );
};

const allowedOrigin = (request: http.IncomingMessage, config: WebSocketRuntimeOptions): boolean => {
  const origin = firstHeaderValue(request.headers.origin);
  if (!origin) return config.allowOriginlessWebSockets;
  try {
    const allowed = new Set(config.passkeyRelyingParties.map((entry) => new URL(entry.origin).origin));
    const host = firstHeaderValue(request.headers['x-forwarded-host']) || firstHeaderValue(request.headers.host);
    const protocol =
      firstHeaderValue(request.headers['x-forwarded-proto']) ||
      ((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted ? 'https' : 'http');
    if (host) allowed.add(new URL(`${protocol}://${host}`).origin);
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
};

const rejectUpgrade = (socket: Socket, status: number, text: string): void => {
  if (!socket.destroyed) socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
};

const parsePositiveInteger = (value: string | null): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseNonNegativeInteger = (value: string | null): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

/** HTTP-server WebSocket boundary: upgrade/auth/origin/IP/heartbeat and clean transport selection only. */
export const attachWebSocketServer = (options: WebSocketServerOptions): BackendWebSocketServer => {
  const { server, sessionMiddleware, config, dependencies } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  const clients = new Set<ClientRecord>();
  let closing = false;

  const trackClient = (record: ClientRecord): void => {
    clients.add(record);
    const alive = () => {
      record.isAlive = true;
      record.missed = 0;
    };
    record.socket.on('pong', alive);
    record.socket.on('message', alive);
    record.socket.once('close', () => clients.delete(record));
  };

  const onWorkspaceConnection = (socket: WebSocket, userId: number, username: string, clientIp: string): void => {
    const protocol = new WorkspaceProtocolSession(socket, { userId, username, clientIp }, dependencies);
    const record: ClientRecord = { socket, kind: 'workspace', protocol, isAlive: true, missed: 0 };
    trackClient(record);
    socket.on('message', (data, isBinary) => void protocol.handleMessage(data, isBinary));
    socket.once('close', () => void protocol.close());
    socket.once('error', () => void protocol.close());
  };

  const onUploadConnection = (
    socket: WebSocket,
    userId: number,
    request: { workspaceId: string; uploadId: string; size: number },
  ): void => {
    if (!bindUploadStream(socket, userId, request, dependencies)) return;
    trackClient({ socket, kind: 'upload', isAlive: true, missed: 0 });
  };

  const onRemoteDesktopConnection = (
    socket: WebSocket,
    request: { token: string; width: number; height: number; dpi: number },
  ): void => {
    trackClient({ socket, kind: 'remote-desktop', isAlive: true, missed: 0 });
    proxyRemoteDesktop(socket, config.remoteGatewayWsBaseUrl, request);
  };

  const handleAuthenticatedUpgrade = (
    request: SessionRequest,
    socket: Socket,
    head: Buffer,
    url: URL,
    pathname: string,
    userId: number,
    username: string,
    clientIp: string,
  ): void => {
    if (pathname === '/ws/uploads') {
      const workspaceId = url.searchParams.get('workspaceId')?.trim() || '';
      const uploadId = url.searchParams.get('uploadId')?.trim() || '';
      const size = parseNonNegativeInteger(url.searchParams.get('size'));
      if (!SAFE_WORKSPACE_ID.test(workspaceId) || !uploadId || uploadId.length > 512 || size === null) {
        rejectUpgrade(socket, 400, 'Bad Request');
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => onUploadConnection(ws, userId, { workspaceId, uploadId, size }));
      return;
    }

    if (pathname === '/ws/remote-desktop') {
      const token = url.searchParams.get('token')?.trim() || '';
      const width = parsePositiveInteger(url.searchParams.get('width'));
      const height = parsePositiveInteger(url.searchParams.get('height'));
      const dpi = parsePositiveInteger(url.searchParams.get('dpi'));
      if (!token || width === null || height === null || dpi === null) {
        rejectUpgrade(socket, 400, 'Bad Request');
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => onRemoteDesktopConnection(ws, { token, width, height, dpi }));
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => onWorkspaceConnection(ws, userId, username, clientIp));
  };

  const upgradeHandler = (request: http.IncomingMessage, socket: Socket, head: Buffer): void => {
    if (closing) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }

    let url: URL;
    try {
      url = new URL(request.url || '/', 'http://nexus.local');
    } catch {
      rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }
    const pathname = url.pathname;
    if (!ALLOWED_PATHS.has(pathname)) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    if (!allowedOrigin(request, config)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }

    const clientIp = resolveClientIp(request);
    void dependencies.ipWhitelist
      .check(clientIp)
      .then((decision) => {
        if (!decision.allowed) {
          rejectUpgrade(
            socket,
            decision.statusCode,
            decision.statusCode === 500 ? 'Internal Server Error' : 'Forbidden',
          );
          return;
        }

        const sessionResponse: Response = Object.setPrototypeOf(new http.ServerResponse(request), express.response);
        sessionMiddleware(request as SessionRequest, sessionResponse, () => {
          const sessionRequest = request as SessionRequest;
          const userId = sessionRequest.session?.userId;
          const username = sessionRequest.session?.username;
          if (!userId || !username || sessionRequest.session.requiresTwoFactor === true) {
            rejectUpgrade(socket, 401, 'Unauthorized');
            return;
          }
          handleAuthenticatedUpgrade(sessionRequest, socket, head, url, pathname, userId, username, clientIp);
        });
      })
      .catch(() => rejectUpgrade(socket, 500, 'Internal Server Error'));
  };

  server.on('upgrade', upgradeHandler);

  const heartbeat = setInterval(() => {
    for (const record of clients) {
      if (record.isAlive) {
        record.isAlive = false;
        record.missed = 0;
      } else {
        record.missed += 1;
        if (record.missed >= MAX_MISSED_HEARTBEATS) {
          void record.protocol?.close();
          record.socket.terminate();
          continue;
        }
      }
      if (record.socket.readyState === WebSocket.OPEN) record.socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  return {
    close: async () => {
      if (closing) return;
      closing = true;
      server.off('upgrade', upgradeHandler);
      clearInterval(heartbeat);
      await Promise.allSettled([...clients].map((record) => record.protocol?.close() ?? Promise.resolve()));
      for (const record of clients) {
        if (record.socket.readyState === WebSocket.OPEN || record.socket.readyState === WebSocket.CONNECTING) {
          record.socket.terminate();
        }
      }
      clients.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
};
