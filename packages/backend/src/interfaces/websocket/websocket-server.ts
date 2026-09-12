import http from 'node:http';
import type { Socket } from 'node:net';
import express, { type Request, type RequestHandler, type Response } from 'express';
import ipaddr from 'ipaddr.js';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import type { IpWhitelistService } from '../../modules/auth/ip-whitelist.service';
import type { AgentEventFacade, AgentRunFacade, AgentWorkspaceRuntimeFacade } from '../../modules/agent/public';
import { logger } from '../../shared/logging/logger';
import { runtimePerformanceMetrics } from '../../shared/observability/runtime-performance';
import { AgentProtocolSession } from './agent-protocol.session';
import { AgentTerminalProtocolSession } from './agent-terminal-protocol.session';
import { bindUploadStream } from './upload-stream.transport';
import { WorkspaceProtocolSession, type WorkspaceProtocolDependencies } from './workspace-protocol.session';

const ALLOWED_PATHS = new Set([
  '/ws/workspace',
  '/ws/uploads',
  '/ws/remote-desktop',
  '/ws/agent',
  '/ws/agent-terminal',
]);
const SAFE_WORKSPACE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_MISSED_HEARTBEATS = 2;
const MAX_AGENT_SOCKETS_PER_SESSION = 3;

interface SessionRequest extends Request {
  session: Request['session'];
}

interface ClientRecord {
  socket: WebSocket;
  kind: 'workspace' | 'upload' | 'remote-desktop' | 'agent' | 'agent-terminal';
  protocol?: { close(): Promise<void> | void };
  agentProtocol?: AgentProtocolSession;
  agentSessionKey?: string;
  isAlive: boolean;
  missed: number;
}

export interface RemoteDesktopWebSocketAcceptor {
  accept(socket: WebSocket, request: http.IncomingMessage, ticket: string, userId: number): boolean;
}

export interface WebSocketServerDependencies extends WorkspaceProtocolDependencies {
  ipWhitelist: IpWhitelistService;
  remoteDesktop: RemoteDesktopWebSocketAcceptor;
  agentEvents: AgentEventFacade;
  agentRuns: AgentRunFacade;
  agentWorkspaceRuntime: AgentWorkspaceRuntimeFacade;
}

export interface WebSocketRuntimeOptions {
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
  metrics(): {
    total: number;
    workspace: number;
    upload: number;
    remoteDesktop: number;
    agent: number;
    agentTerminal: number;
    agentSubscriptions: number;
    agentMaxReplayLag: number;
    agentProtocolErrors: number;
    agentSlowConsumerCloses: number;
    agentConnectionLimitRejections: number;
    bufferedAmountBytes: number;
    maxBufferedAmountBytes: number;
  };
  /** Pause new upgrades, fully drain current clients, run an exclusive lifecycle operation, then resume upgrades. */
  quiesce<T>(operation: () => Promise<T>): Promise<T>;
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
  runtimePerformanceMetrics.webSocketUpgradeRejected();
  if (!socket.destroyed) socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
};

const rawDataByteLength = (data: RawData): number => {
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (Array.isArray(data)) return data.reduce((total, item) => total + item.byteLength, 0);
  return data.byteLength;
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
  let quiesceDepth = 0;
  let agentMaxReplayLag = 0;
  let agentProtocolErrors = 0;
  let agentSlowConsumerCloses = 0;
  let agentConnectionLimitRejections = 0;
  let quiesceTail: Promise<void> = Promise.resolve();

  const trackClient = (record: ClientRecord): void => {
    clients.add(record);
    logger.debug({ websocketKind: record.kind, activeClients: clients.size }, 'WebSocket client attached');
    const alive = () => {
      record.isAlive = true;
      record.missed = 0;
    };
    record.socket.on('pong', alive);
    record.socket.on('message', alive);
    record.socket.on('message', (data) => runtimePerformanceMetrics.recordWebSocketInbound(rawDataByteLength(data)));
    record.socket.once('close', (code) => {
      clients.delete(record);
      logger.debug(
        { websocketKind: record.kind, closeCode: code, activeClients: clients.size },
        'WebSocket client detached',
      );
    });
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
    request: http.IncomingMessage,
    ticket: string,
    userId: number,
  ): void => {
    if (!dependencies.remoteDesktop.accept(socket, request, ticket, userId)) {
      socket.close(1008, 'Remote desktop ticket invalid or expired');
      return;
    }
    trackClient({ socket, kind: 'remote-desktop', isAlive: true, missed: 0 });
  };

  const onAgentConnection = (socket: WebSocket, userId: number, sessionKey: string): void => {
    const protocol = new AgentProtocolSession(
      socket,
      { userId },
      {
        events: dependencies.agentEvents,
        runs: dependencies.agentRuns,
        telemetry: {
          replayLag: (lag) => {
            agentMaxReplayLag = Math.max(agentMaxReplayLag, lag);
          },
          protocolError: () => {
            agentProtocolErrors += 1;
          },
          slowConsumerClose: () => {
            agentSlowConsumerCloses += 1;
          },
        },
      },
    );
    const record: ClientRecord = {
      socket,
      kind: 'agent',
      protocol,
      agentProtocol: protocol,
      agentSessionKey: sessionKey,
      isAlive: true,
      missed: 0,
    };
    trackClient(record);
    socket.on('message', (data, isBinary) => void protocol.handleMessage(data, isBinary));
    socket.once('close', () => void protocol.close());
    socket.once('error', () => void protocol.close());
  };

  const onAgentTerminalConnection = (
    socket: WebSocket,
    userId: number,
    request: {
      appId: string;
      workspaceId: string;
      generation: number;
      columns: number;
      rows: number;
      sessionId?: string;
    },
  ): void => {
    const protocol = new AgentTerminalProtocolSession(
      socket,
      { userId, ...request },
      dependencies.agentWorkspaceRuntime,
    );
    const record: ClientRecord = { socket, kind: 'agent-terminal', protocol, isAlive: true, missed: 0 };
    trackClient(record);
    socket.on('message', (data, isBinary) => protocol.handleMessage(data, isBinary));
    socket.once('close', () => void protocol.close());
    socket.once('error', () => void protocol.close());
    void protocol.start().catch((error) => {
      logger.warn(
        { err: error, workspaceId: request.workspaceId, generation: request.generation },
        'Agent terminal open failed',
      );
      if (socket.readyState === WebSocket.OPEN)
        socket.close(1008, error instanceof Error ? error.message.slice(0, 100) : 'Workspace terminal denied');
      void protocol.close();
    });
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
      wss.handleUpgrade(request, socket, head, (ws) => {
        runtimePerformanceMetrics.webSocketUpgradeAccepted();
        onUploadConnection(ws, userId, { workspaceId, uploadId, size });
      });
      return;
    }

    if (pathname === '/ws/remote-desktop') {
      const ticket = url.searchParams.get('ticket')?.trim() || '';
      if (!ticket || ticket.length > 256) {
        rejectUpgrade(socket, 400, 'Bad Request');
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        runtimePerformanceMetrics.webSocketUpgradeAccepted();
        onRemoteDesktopConnection(ws, request, ticket, userId);
      });
      return;
    }

    if (pathname === '/ws/agent-terminal') {
      const appId = url.searchParams.get('appId')?.trim() || '';
      const workspaceId = url.searchParams.get('workspaceId')?.trim() || '';
      const generation = Number(url.searchParams.get('generation'));
      const columns = Number(url.searchParams.get('columns') ?? '80');
      const rows = Number(url.searchParams.get('rows') ?? '24');
      const sessionId = url.searchParams.get('sessionId')?.trim() || undefined;
      if (
        !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.test(appId) ||
        !workspaceId ||
        workspaceId.length > 128 ||
        !Number.isSafeInteger(generation) ||
        generation < 1 ||
        !Number.isSafeInteger(columns) ||
        columns < 2 ||
        columns > 1000 ||
        !Number.isSafeInteger(rows) ||
        rows < 1 ||
        rows > 500 ||
        (sessionId !== undefined &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId))
      ) {
        rejectUpgrade(socket, 400, 'Bad Request');
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        runtimePerformanceMetrics.webSocketUpgradeAccepted();
        onAgentTerminalConnection(ws, userId, {
          appId,
          workspaceId,
          generation,
          columns,
          rows,
          ...(sessionId ? { sessionId } : {}),
        });
      });
      return;
    }

    if (pathname === '/ws/agent') {
      const sessionKey = request.sessionID || `user:${userId}`;
      const activeForSession = [...clients].filter(
        (record) => record.kind === 'agent' && record.agentSessionKey === sessionKey,
      ).length;
      if (activeForSession >= MAX_AGENT_SOCKETS_PER_SESSION) {
        agentConnectionLimitRejections += 1;
        rejectUpgrade(socket, 429, 'Too Many Requests');
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        runtimePerformanceMetrics.webSocketUpgradeAccepted();
        onAgentConnection(ws, userId, sessionKey);
      });
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      runtimePerformanceMetrics.webSocketUpgradeAccepted();
      onWorkspaceConnection(ws, userId, username, clientIp);
    });
  };

  const upgradeHandler = (request: http.IncomingMessage, socket: Socket, head: Buffer): void => {
    runtimePerformanceMetrics.webSocketUpgradeAttempt();
    if (closing || quiesceDepth > 0) {
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
    logger.trace({ path: pathname }, 'WebSocket upgrade dispatch');
    if (!ALLOWED_PATHS.has(pathname)) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    if (!allowedOrigin(request, config)) {
      logger.debug({ path: pathname }, 'WebSocket upgrade rejected by origin policy');
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }

    const clientIp = resolveClientIp(request);
    void dependencies.ipWhitelist
      .check(clientIp)
      .then((decision) => {
        if (!decision.allowed) {
          logger.debug({ path: pathname, statusCode: decision.statusCode }, 'WebSocket upgrade rejected by IP policy');
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
            logger.debug({ path: pathname }, 'WebSocket upgrade rejected by session policy');
            rejectUpgrade(socket, 401, 'Unauthorized');
            return;
          }
          handleAuthenticatedUpgrade(sessionRequest, socket, head, url, pathname, userId, username, clientIp);
        });
      })
      .catch((error) => {
        logger.error({ err: error, path: pathname }, 'WebSocket IP policy check failed');
        rejectUpgrade(socket, 500, 'Internal Server Error');
      });
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
          logger.warn(
            { websocketKind: record.kind, missedHeartbeats: record.missed },
            'WebSocket client heartbeat expired',
          );
          void record.protocol?.close();
          record.socket.terminate();
          continue;
        }
      }
      if (record.socket.readyState === WebSocket.OPEN) record.socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  const waitForSocketClose = (socket: WebSocket): Promise<void> => {
    if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeListener('close', finish);
        resolve();
      };
      const timer = setTimeout(finish, 1_000);
      timer.unref?.();
      socket.once('close', finish);
    });
  };

  const drainClients = async (): Promise<void> => {
    const snapshot = [...clients];
    if (!snapshot.length) return;

    // Workspace protocol teardown owns the application-level cleanup (uploads, transfers,
    // terminal, filesystem and SSH session). Finish that before terminating the raw sockets so a
    // reset cannot return while old workspace work is still mutating the freshly restored state.
    await Promise.allSettled(snapshot.map((record) => record.protocol?.close() ?? Promise.resolve()));

    const closeWaiters = snapshot.map((record) => waitForSocketClose(record.socket));
    for (const record of snapshot) {
      if (record.socket.readyState !== WebSocket.CLOSED) record.socket.terminate();
    }
    await Promise.allSettled(closeWaiters);
    for (const record of snapshot) clients.delete(record);
  };

  return {
    metrics: () => {
      let workspace = 0;
      let upload = 0;
      let remoteDesktop = 0;
      let agent = 0;
      let agentTerminal = 0;
      let agentSubscriptions = 0;
      let bufferedAmountBytes = 0;
      let maxBufferedAmountBytes = 0;
      for (const record of clients) {
        if (record.kind === 'workspace') workspace += 1;
        else if (record.kind === 'upload') upload += 1;
        else if (record.kind === 'remote-desktop') remoteDesktop += 1;
        else if (record.kind === 'agent') {
          agent += 1;
          agentSubscriptions += record.agentProtocol?.subscriptionCount() ?? 0;
        } else agentTerminal += 1;
        bufferedAmountBytes += record.socket.bufferedAmount;
        maxBufferedAmountBytes = Math.max(maxBufferedAmountBytes, record.socket.bufferedAmount);
      }
      return {
        total: clients.size,
        workspace,
        upload,
        remoteDesktop,
        agent,
        agentTerminal,
        agentSubscriptions,
        agentMaxReplayLag,
        agentProtocolErrors,
        agentSlowConsumerCloses,
        agentConnectionLimitRejections,
        bufferedAmountBytes,
        maxBufferedAmountBytes,
      };
    },
    quiesce: <T>(operation: () => Promise<T>): Promise<T> => {
      quiesceDepth += 1;
      const previous = quiesceTail;
      let release!: () => void;
      quiesceTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      return previous
        .then(async () => {
          await drainClients();
          return operation();
        })
        .finally(() => {
          quiesceDepth = Math.max(0, quiesceDepth - 1);
          release();
        });
    },
    close: async () => {
      if (closing) return;
      closing = true;
      server.off('upgrade', upgradeHandler);
      clearInterval(heartbeat);
      await quiesceTail;
      await drainClients();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
};
